// Where a run's confidence cutoff comes from.
//
// The label head (text classification labels, language understanding intents)
// gets a ROC: "was the top-1 prediction correct?" is a real binary question, so
// both rates have genuine denominators. Annotations get precision-recall
// instead — raising the cutoff only ever removes predicted annotations, so
// there is no population of true negatives for a false-positive rate to divide
// by, and a ROC drawn anyway would track the model's over-tagging rate rather
// than its ranking.
//
// The marked point is what Publish offers as the recommended threshold.

import { Table } from "react-bootstrap";
import { FiletypeCsv, GraphUp } from "react-bootstrap-icons";
import {
    CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

import downloadBlob from "../../../../shared/utils/downloadBlob";
import { formatThreshold, getThresholds, thresholdRows } from "../../../../shared/utils/training";
import { curveCsv, trainingFilename } from "../../../../shared/utils/trainingDownloads";
// History.jsx imports this module in turn. The cycle resolves only because
// every binding below is read inside a component body, long after both modules
// have evaluated — History.jsx's `import ThresholdsPanel` sits well above the
// definitions of PanelCard and useEvaluationView. Reading any of them at module
// scope here would be a temporal-dead-zone crash at run time, which the build
// does not catch; move them to their own module before doing that.
import {
    DownloadButton, EvaluationControls, PanelCard, formatMetric, useEvaluationView
} from "./History";

// The two curves plot different axes, and everything downstream — the summary
// label, the chart, the CSV — keys off this one table.
const CURVES = {
    label: {
        summary: "AUC",
        x: "fpr",
        y: "tpr",
        xLabel: "False positive rate",
        yLabel: "True positive rate",
        unit: "label",
        note: "Chance is the diagonal. The marked point maximises TPR − FPR."
    },
    annotation: {
        summary: "Average precision",
        x: "recall",
        y: "precision",
        xLabel: "Recall",
        yLabel: "Precision",
        unit: "annotation",
        note: "The marked point maximises F1."
    }
};

const ThresholdsPanel = ({ training, model }) => {
    const view = useEvaluationView(training);
    const metrics = getThresholds(training, view.split, view.head);
    const spec = metrics ? CURVES[metrics.kind] : null;
    const rows = thresholdRows(metrics);

    // The backend stores the operating point's own coordinates. Matching the
    // threshold against the curve would fail: the threshold is a six-decimal
    // value off the raw scores, the curve a two-decimal grid.
    const operating = metrics?.operating;

    return (
        <PanelCard
            icon={<GraphUp />}
            title={view.title}
            className="p-0"
            controls={
                <EvaluationControls
                    heads={view.heads}
                    split={view.split}
                    onSplit={view.setSplit}
                    head={view.head}
                    onHead={view.setHead}
                />
            }
            actions={
                <DownloadButton
                    title="Download curve CSV"
                    icon={<FiletypeCsv />}
                    disabled={!metrics}
                    onClick={() => downloadBlob(
                        curveCsv(metrics.curve, metrics.kind),
                        trainingFilename(model, training, view.suffix("curve.csv"))
                    )}
                />
            }
        >
            {metrics ? (
                <div className="px-3 pb-3">
                    <div className="d-flex flex-wrap align-items-baseline gap-3 small mb-2">
                        <span>
                            <span className="text-muted">{spec.summary}</span>{" "}
                            <span className="fw-bold">{formatMetric(metrics.summary)}</span>
                        </span>
                        <span>
                            <span className="text-muted">
                                {/* Publish offers the test-split point. Calling the
                                    train-split one "recommended" would contradict it. */}
                                {view.split === 'test' ? 'Recommended threshold' : 'Best threshold here'}
                            </span>{" "}
                            <span className="fw-bold">{formatThreshold(metrics.threshold)}</span>
                        </span>
                        <span className="text-muted">{spec.note}</span>
                    </div>
                    <div style={{ height: "320px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={metrics.curve} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis
                                    type="number"
                                    dataKey={spec.x}
                                    domain={[0, 1]}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: spec.xLabel, position: "insideBottom", offset: -12, fontSize: 11 }}
                                />
                                <YAxis
                                    type="number"
                                    domain={[0, 1]}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: spec.yLabel, angle: -90, position: "insideLeft", fontSize: 11 }}
                                />
                                <Tooltip
                                    formatter={(value, name) => [formatMetric(value), name]}
                                    labelFormatter={() => ""}
                                />
                                {metrics.kind === "label" && (
                                    <Line
                                        type="linear"
                                        dataKey={spec.x}
                                        stroke="currentColor"
                                        strokeDasharray="4 4"
                                        strokeOpacity={0.3}
                                        dot={false}
                                        isAnimationActive={false}
                                        name="chance"
                                    />
                                )}
                                <Line
                                    type="monotone"
                                    dataKey={spec.y}
                                    stroke="#20c997"
                                    strokeWidth={2}
                                    dot={false}
                                    isAnimationActive={false}
                                    name={spec.yLabel}
                                />
                                {operating && (
                                    <ReferenceDot
                                        x={operating[spec.x]}
                                        y={operating[spec.y]}
                                        r={5}
                                        fill="#20c997"
                                        stroke="none"
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-muted small mb-3">
                        {view.split === 'test'
                            ? 'Fitted on this split, so the score at this threshold is mildly optimistic — the same rows chose the cutoff and reported the result.'
                            : 'The training-split curve, for comparison. The recommended cutoff is fitted on the test split, not this one, because training scores are inflated by memorization.'}
                    </p>
                    {rows.length > 0 && (
                        <Table responsive size="sm" className="small border border-light-subtle mb-0">
                            <thead className="bg-body-tertiary">
                                <tr className="border-bottom border-light-subtle">
                                    <th className="border-end border-light-subtle text-capitalize">{spec.unit}</th>
                                    <th className="border-end border-light-subtle">{spec.summary}</th>
                                    <th className="border-end border-light-subtle">Best threshold</th>
                                    <th>Support</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.label} className="border-bottom border-light-subtle">
                                        <td className="border-end border-light-subtle">{row.label}</td>
                                        <td className="border-end border-light-subtle">
                                            {row.score === null ? '—' : formatMetric(row.score)}
                                        </td>
                                        <td className="border-end border-light-subtle">
                                            {formatThreshold(row.threshold)}
                                        </td>
                                        <td>{row.support ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </div>
            ) : (
                <div className="text-muted small px-3 pb-3" style={{ minHeight: "400px" }}>
                    No curve for this split. Either the run predates thresholds, or the
                    data could not support one — a ROC needs both a correct and an
                    incorrect prediction, and a precision-recall curve needs at least one
                    annotation to find. On the training split a well-fit model is often
                    right about everything, which leaves a ROC nothing to separate.
                </div>
            )}
        </PanelCard>
    );
};

export default ThresholdsPanel;
