// The dataset comparison shown on the History Data tab: the utterances added,
// removed and edited between two training versions.
//
// Uses Myers' greedy diff, which costs O((n+m)·D) in D, the number of differing
// lines — not O(n·m) in dataset size. That distinction is the whole point here:
// consecutive versions of a dataset differ by a handful of rows out of
// thousands, so D stays tiny however large the dataset grows. The dynamic
// programming table this replaced was sized by the dataset instead, and on a
// real one ran to hundreds of millions of cells: slow enough to freeze the tab
// and, past ~20k utterances, large enough for the allocation to fail outright.
//
// Kept in a plain module so it can run either on the main thread or inside
// diff.worker.js. Unchanged lines are omitted from the result, so what crosses
// the worker boundary is only the rows the viewer draws.

// Ceiling on the edit distance explored before giving up on aligning. Reaching
// it means the two versions share almost nothing, where an alignment tells the
// reader no more than "all of this changed" — and the trace is what holds
// memory, so it has to be bounded by something.
const MAX_DIFFERENCES = 2000;

const toLines = (value) => (value || '').split('\n').filter(l => l.trim());

const removals = (lines) => lines.map(line => ({ type: 'remove', old: line, new: '' }));
const additions = (lines) => lines.map(line => ({ type: 'add', old: '', new: line }));

// Whether two rows are the same utterance re-labelled or re-annotated rather
// than one row deleted and an unrelated one inserted. Compares the utterance
// column only — the label and spans after the tab are what is being edited.
const isEdit = (oldLine, newLine) => {
    const u1 = oldLine.split('\t')[0] || '';
    const u2 = newLine.split('\t')[0] || '';
    const longest = Math.max(u1.length, u2.length);
    if (longest === 0) return false;

    let common = 0;
    while (common < u1.length && common < u2.length && u1[common] === u2[common]) common++;
    let suffix = 0;
    while (suffix < u1.length - common && suffix < u2.length - common &&
        u1[u1.length - 1 - suffix] === u2[u2.length - 1 - suffix]) suffix++;

    return (common + suffix) / longest > 0.5;
};

// Myers' O((n+m)·D) greedy algorithm. Walks furthest-reaching paths outward by
// edit distance and stops at the first that reaches the end, recording each
// round so the path can be replayed. Returns ordered add/remove operations, or
// null when the budget is exhausted.
const myersOperations = (oldLines, newLines) => {
    const n = oldLines.length;
    const m = newLines.length;
    const maxD = Math.min(n + m, MAX_DIFFERENCES);
    // Diagonals run -maxD..maxD, stored offset into a single array.
    const offset = maxD;
    const furthest = new Int32Array(2 * maxD + 1);
    const trace = [];

    for (let d = 0; d <= maxD; d++) {
        trace.push(furthest.slice());
        for (let k = -d; k <= d; k += 2) {
            // Extend whichever neighbouring diagonal reaches further: downward
            // (an insertion) or rightward (a deletion).
            let x = (k === -d || (k !== d && furthest[k - 1 + offset] < furthest[k + 1 + offset]))
                ? furthest[k + 1 + offset]
                : furthest[k - 1 + offset] + 1;
            let y = x - k;
            // Then slide along the diagonal for free — these lines are equal.
            while (x < n && y < m && oldLines[x] === newLines[y]) { x++; y++; }
            furthest[k + offset] = x;

            if (x >= n && y >= m) return backtrack(trace, oldLines, newLines, n, m, offset);
        }
    }
    return null;
};

// Replays the recorded rounds backwards, emitting one operation per round and
// skipping the diagonal runs, which are the unchanged lines.
//
// Unchanged lines are dropped from the output, so each operation carries the
// hunk it belongs to — a run of changes with no matching line between them.
// That is the only remaining record of which changes were adjacent, and pairing
// edits below depends on it.
const backtrack = (trace, oldLines, newLines, n, m, offset) => {
    const operations = [];
    let x = n, y = m;
    let hunk = 0;

    for (let d = trace.length - 1; d >= 0; d--) {
        const furthest = trace[d];
        const k = x - y;
        const previousK = (k === -d || (k !== d && furthest[k - 1 + offset] < furthest[k + 1 + offset]))
            ? k + 1
            : k - 1;
        const previousX = furthest[previousK + offset];
        const previousY = previousX - previousK;

        // Matching lines separate what came before from what comes next.
        if (x > previousX && y > previousY) {
            hunk++;
            while (x > previousX && y > previousY) { x--; y--; }
        }
        if (d > 0) {
            operations.push(x > previousX
                ? { hunk, type: 'remove', old: oldLines[previousX], new: '' }
                : { hunk, type: 'add', old: '', new: newLines[previousY] });
        }
        x = previousX;
        y = previousY;
    }
    return operations.reverse();
};

// Myers only ever deletes or inserts, and in either order — an edited row can
// come back as the insertion before the deletion. Within one hunk that ordering
// carries no meaning, so pair the deletions against the insertions positionally
// and collapse near-identical text into single side-by-side rows.
const pairEdits = (operations) => {
    const result = [];
    let index = 0;

    while (index < operations.length) {
        let end = index;
        while (end < operations.length && operations[end].hunk === operations[index].hunk) end++;

        const removed = [];
        const added = [];
        for (let at = index; at < end; at++) {
            (operations[at].type === 'remove' ? removed : added).push(operations[at]);
        }

        const pairs = Math.min(removed.length, added.length);
        for (let pair = 0; pair < pairs; pair++) {
            const { old } = removed[pair];
            const replacement = added[pair].new;
            if (isEdit(old, replacement)) {
                result.push({ type: 'change', old, new: replacement });
            } else {
                result.push({ type: 'remove', old, new: '' }, { type: 'add', old: '', new: replacement });
            }
        }
        for (let rest = pairs; rest < removed.length; rest++) {
            result.push({ type: 'remove', old: removed[rest].old, new: '' });
        }
        for (let rest = pairs; rest < added.length; rest++) {
            result.push({ type: 'add', old: '', new: added[rest].new });
        }

        index = end;
    }
    return result;
};

export const computeDiffLines = (oldValue, newValue) => {
    const oldLines = toLines(oldValue);
    const newLines = toLines(newValue);

    // An identical head and tail contribute no rows and, between two versions,
    // are most of the dataset. Trimming them first shrinks what Myers walks.
    let head = 0;
    while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;

    let tail = 0;
    while (tail < oldLines.length - head && tail < newLines.length - head &&
        oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;

    const oldWindow = oldLines.slice(head, oldLines.length - tail);
    const newWindow = newLines.slice(head, newLines.length - tail);

    if (oldWindow.length === 0) return additions(newWindow);
    if (newWindow.length === 0) return removals(oldWindow);

    const operations = myersOperations(oldWindow, newWindow);
    // Past the budget the two versions share almost nothing; reporting the old
    // rows gone and the new rows added says the same thing at a bounded cost.
    if (operations === null) return [...removals(oldWindow), ...additions(newWindow)];

    return pairEdits(operations);
};
