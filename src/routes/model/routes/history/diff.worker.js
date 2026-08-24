// Runs the O(n·m) dataset diff off the main thread so the History page stays
// interactive while two large utterance CSVs are being compared.

import { computeDiffLines } from './diffLines';

self.onmessage = ({ data }) => {
    self.postMessage(computeDiffLines(data.oldValue, data.newValue));
};
