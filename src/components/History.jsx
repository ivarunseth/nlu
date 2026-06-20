import { useContext, useEffect, useState, useRef, useMemo } from "react";
import { Alert, Button, ButtonGroup, Col, Row, Form, FormGroup, OverlayTrigger, Popover, Spinner, Table, Dropdown, Pagination, Modal, Tabs, Tab, Badge, Card, InputGroup } from "react-bootstrap";
import {
    BarChart,
    Bug,
    Clipboard,
    Download,
    FileDiff,
    FileText,
    Grid,
    InfoCircle,
    Sliders,
    Trash,
    QuestionCircle,
    ArrowClockwise,
    Hash,
    Activity,
    Calendar3,
    Check2Circle,
    Clock,
    GraphUp,
    ZoomIn,
    ArrowRepeat,
    StopCircleFill
} from "react-bootstrap-icons";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend as RechartsLegend,
    ResponsiveContainer,
    ScatterChart,
    Scatter,
    ZAxis,
    Cell,
    ReferenceArea,
    LabelList
} from 'recharts';
import { UserContext } from "../contexts/UserContext";
import { ModelContext } from "../contexts/ModelContext";
import { useSocket } from "../contexts/SocketContext";
import { Link, useParams } from "react-router-dom";
import useDebounce from '../useDebounce';
import axios from "axios";

const SubstringDiffLine = ({ text, otherText, type }) => {
    if (!text) return <span>&nbsp;</span>;
    if (!otherText) return <span>{text}</span>;
    let i = 0;
    while (i < text.length && i < otherText.length && text[i] === otherText[i]) i++;
    let j = 0;
    while (j < text.length - i && j < otherText.length - i &&
        text[text.length - 1 - j] === otherText[otherText.length - 1 - j]) j++;
    const prefix = text.substring(0, i);
    const suffix = text.substring(text.length - j);
    const part = text.substring(i, text.length - j);
    return (
        <>
            {prefix}
            {part && (
                <span className={type === 'old' ? 'bg-danger bg-opacity-25' : 'bg-success bg-opacity-25'} style={{ borderRadius: '2px' }}>
                    {part}
                </span>
            )}
            {suffix}
        </>
    );
};

const SimpleDiffViewer = ({ oldValue, newValue, oldVersion, newVersion }) => {
    const diffLines = useMemo(() => {
        const oldLines = oldValue.split('\n').filter(l => l.trim());
        const newLines = newValue.split('\n').filter(l => l.trim());

        const n = oldLines.length;
        const m = newLines.length;
        const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        const result = [];
        let i = n, j = m;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                i--; j--;
            } else if (i > 0 && j > 0 && dp[i][j - 1] === dp[i - 1][j]) {
                const u1 = oldLines[i - 1].split('\t')[0] || '';
                const u2 = newLines[j - 1].split('\t')[0] || '';

                let common = 0;
                while (common < u1.length && common < u2.length && u1[common] === u2[common]) common++;
                let suffix = 0;
                while (suffix < u1.length - common && suffix < u2.length - common &&
                    u1[u1.length - 1 - suffix] === u2[u2.length - 1 - suffix]) suffix++;

                const similarity = Math.max(u1.length, u2.length) > 0
                    ? (common + suffix) / Math.max(u1.length, u2.length)
                    : 0;

                if (similarity > 0.5) {
                    result.unshift({ type: 'change', old: oldLines[i - 1], new: newLines[j - 1] });
                    i--; j--;
                } else {
                    result.unshift({ type: 'add', old: '', new: newLines[j - 1] });
                    j--;
                }
            } else if (j > 0 && (i === 0 || dp[i][j - 1] > dp[i - 1][j])) {
                result.unshift({ type: 'add', old: '', new: newLines[j - 1] });
                j--;
            } else {
                result.unshift({ type: 'remove', old: oldLines[i - 1], new: '' });
                i--;
            }
        }
        return result;
    }, [oldValue, newValue]);

    const [page, setPage] = useState(1);
    const perPage = 50;
    const totalPages = Math.ceil(diffLines.length / perPage);
    const displayedLines = diffLines.slice(0, page * perPage);

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 50 && page < totalPages) {
            setPage(prev => prev + 1);
        }
    };

    if (diffLines.length === 0) {
        return (
            <div className="p-4 text-center text-muted">
                <Check2Circle className="fs-1 mb-2 text-success" />
                <p className="mb-0 small fw-bold">No changes detected</p>
            </div>
        );
    }

    return (
        <div className="bg-white overflow-auto" style={{ height: 'calc(100vh - 400px)', minHeight: '400px' }} onScroll={handleScroll}>
            <Table responsive size="sm" className="font-monospace small mb-0 table-fixed border-0">
                <thead className="sticky-top bg-white">
                    <tr className="border-bottom border-light-subtle">
                        <th style={{ width: '50%' }} className="px-3 py-2 border-start-0 border-end border-light-subtle">
                            {oldVersion === '0' ? 'Initial' : `v${oldVersion}`}
                        </th>
                        <th style={{ width: '50%' }} className="px-3 py-2 border-end-0">
                            v{newVersion}&nbsp;(Selected)
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {displayedLines.map((line, idx) => (
                        <tr key={idx} className="border-bottom border-light-subtle">
                            <td className={`px-3 py-1 border-start-0 border-end border-light-subtle text-break position-relative ${line.type === 'remove' ? 'bg-danger bg-opacity-10' : ''} ${line.type === 'change' ? 'bg-danger bg-opacity-10' : ''}`}>
                                {(line.type === 'remove' || line.type === 'change') && (
                                    <>
                                        <span className="text-danger fw-bold position-absolute start-0 ps-1" style={{ fontSize: '0.7rem' }}>-</span>
                                        <span className="ps-2">
                                            <SubstringDiffLine text={line.old} otherText={line.new} type="old" />
                                        </span>
                                    </>
                                )}
                            </td>
                            <td className={`px-3 py-1 border-end-0 text-break position-relative ${line.type === 'add' ? 'bg-success bg-opacity-10' : ''} ${line.type === 'change' ? 'bg-success bg-opacity-10' : ''}`}>
                                {(line.type === 'add' || line.type === 'change') && (
                                    <>
                                        <span className="text-success fw-bold position-absolute start-0 ps-1" style={{ fontSize: '0.7rem' }}>+</span>
                                        <span className="ps-2">
                                            <SubstringDiffLine text={line.new} otherText={line.old} type="new" />
                                        </span>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
            {page < totalPages && (
                <div className="p-3 text-center text-muted small border-top border-light-subtle bg-light">
                    Scrolling for more...
                </div>
            )}
        </div>
    );
};

const PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
];

const ARCHITECTURES_BY_MODEL = {
    text_classification: ['deep_neural_network', 'transformer'],
    named_entity_recognition: ['recurrent_neural_network', 'transformer'],
    natural_language_understanding: ['transformer']
};

const ARCHITECTURE_DEFAULTS = {
    deep_neural_network: {
        architecture: { default: 'deep_neural_network' },
        validation_split: { default: 0.1, min: 0, max: 0.5, step: 0.05 },
        epochs: { default: 200, min: 1, max: 1000, step: 1 },
        batch_size: { default: 32, min: 4, max: 128, step: 4 },
        max_tokens: { default: 10000, min: 1000, max: 50000, step: 1000 },
        sequence_length: { default: 100, min: 16, max: 512, step: 8 },
        embedding_dims: { default: 64, min: 16, max: 512, step: 8 },
        dropout: { default: 0.2, min: 0, max: 1, step: 0.05 },
        early_stopping: { default: true },
        monitor: { default: 'val_loss' },
        patience: { default: 10, min: 1, max: 50, step: 1 },
        save_format: { default: 'tf' }
    },
    recurrent_neural_network: {
        architecture: { default: 'recurrent_neural_network' },
        validation_split: { default: 0.1, min: 0, max: 0.5, step: 0.05 },
        epochs: { default: 100, min: 1, max: 1000, step: 1 },
        batch_size: { default: 32, min: 4, max: 128, step: 4 },
        max_tokens: { default: 10000, min: 1000, max: 50000, step: 1000 },
        sequence_length: { default: 128, min: 16, max: 512, step: 8 },
        embedding_dims: { default: 64, min: 16, max: 512, step: 8 },
        lstm_dims: { default: 100, min: 16, max: 512, step: 8 },
        dropout: { default: 0.2, min: 0, max: 1, step: 0.05 },
        early_stopping: { default: true },
        monitor: { default: 'val_loss' },
        patience: { default: 10, min: 1, max: 50, step: 1 },
        save_format: { default: 'tf' }
    },
    transformer: {
        architecture: { default: 'transformer' },
        pretrained_model: { default: PRETRAINED_MODELS[0] },
        validation_split: { default: 0.1, min: 0, max: 0.5, step: 0.05 },
        epochs: { default: 5, min: 1, max: 100, step: 1 },
        batch_size: { default: 16, min: 4, max: 128, step: 4 },
        max_seq_len: { default: 128, min: 16, max: 512, step: 8 },
        trainable: { default: false },
        units: { default: 768, min: 64, max: 1024, step: 64 },
        dropout: { default: 0.15, min: 0, max: 1, step: 0.05 },
        l2: { default: 0.01, min: 0, max: 0.1, step: 0.001 },
        learning_rate: { default: 0.00002, min: 0.000001, max: 0.001, step: 0.000001 },
        weight_decay_rate: { default: 0.01, min: 0, max: 0.1, step: 0.001 },
        num_warmup_steps: { default: 0, min: 0, max: 5000, step: 10 },
        early_stopping: { default: true },
        monitor: { default: 'val_loss' },
        patience: { default: 3, min: 1, max: 50, step: 1 },
        save_format: { default: 'tf' }
    }
};

const getDefaultParameters = (modelType = 'text_classification') => {
    const architecture = ARCHITECTURES_BY_MODEL[modelType]?.[0] || 'deep_neural_network';
    const defaults = ARCHITECTURE_DEFAULTS[architecture];
    const params = {};
    Object.keys(defaults).forEach(key => {
        params[key] = defaults[key].default;
    });
    return params;
};

const TRAINING_ACTIVE_STATUSES = ['PENDING', 'RECEIVED', 'STARTED'];
const TRAINING_DONE_STATUSES = ['SUCCESS', 'FAILURE', 'ABORTED', 'REVOKED'];
const TRAINING_DELETABLE_STATUSES = ['SUCCESS', 'FAILURE', 'ABORTED', 'REVOKED'];

const isTrainingActive = (training) => TRAINING_ACTIVE_STATUSES.includes(training?.status);
const isTrainingReady = (training) => TRAINING_DONE_STATUSES.includes(training?.status);
const isTrainingDeletable = (training) => TRAINING_DELETABLE_STATUSES.includes(training?.status);
const mergeTraining = (training, data) => ({
    ...training,
    ...data,
    task_id: data.task_id || training?.task_id
});

const getTrainingStatusBadge = (status) => {
    switch (status) {
        case 'SUCCESS': return <Badge bg="success">SUCCESS</Badge>;
        case 'FAILURE': return <Badge bg="danger">FAILURE</Badge>;
        case 'ABORTED': return <Badge bg="warning" text="dark">ABORTED</Badge>;
        case 'REVOKED': return <Badge bg="warning" text="dark">REVOKED</Badge>;
        case 'STARTED': return <Badge bg="primary">STARTED</Badge>;
        case 'PENDING':
        case 'RECEIVED': return <Badge bg="info">PENDING</Badge>;
        default: return <Badge bg="secondary">{status || 'CREATED'}</Badge>;
    }
};

const formatReport = (report) => {
    if (!report) return '';
    return typeof report === 'string' ? report : JSON.stringify(report, null, 2);
};

const getReport = (result, split) => (
    result?.evaluation?.[split]?.report
    ?? (split === 'test' ? result?.report : null)
);

const getTrainingAccuracy = (training) => {
    const result = training?.result;
    if (!result) return null;
    return result.accuracy ?? result.evaluation?.test?.accuracy ?? null;
};

const getTrainingReport = (training) => {
    const result = training?.result;
    if (!result) return '';
    return {
        train: getReport(result, 'train'),
        test: getReport(result, 'test'),
        summary: result.summary || '',
        history: result.history || {}
    };
};

const getConfusionMatrix = (training, split) => (
    training?.result?.evaluation?.[split]?.confusion_matrix
    ?? (split === 'test' ? training?.result?.confusion_matrix : null)
);

const reportRows = (report) => {
    if (!report || typeof report === 'string') return [];
    return Object.entries(report)
        .filter(([, metrics]) => metrics && typeof metrics === 'object')
        .map(([label, metrics]) => ({
            label,
            precision: metrics.precision,
            recall: metrics.recall,
            f1: metrics['f1-score'],
            support: metrics.support
        }));
};

const formatMetric = (value) => (
    typeof value === 'number' ? value.toFixed(4) : ''
);

const ReportTable = ({ title, report }) => {
    const rows = reportRows(report);
    const accuracy = report?.accuracy;
    return (
        <div style={{ minHeight: '400px' }}>
            <h6 className="mt-3 small fw-bold text-muted">{title}</h6>
            {rows.length > 0 ? (
                <Table responsive size="sm" className="small border border-light-subtle">
                    <thead className="bg-light sticky-top" style={{ zIndex: 1 }}>
                        <tr className="border-bottom border-light-subtle">
                            <th className="border-end border-light-subtle">Label</th>
                            <th className="border-end border-light-subtle">Precision</th>
                            <th className="border-end border-light-subtle">Recall</th>
                            <th className="border-end border-light-subtle">F1-score</th>
                            <th>Support</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.label} className="border-bottom border-light-subtle">
                                <td className="border-end border-light-subtle">{row.label}</td>
                                <td className="border-end border-light-subtle">{formatMetric(row.precision)}</td>
                                <td className="border-end border-light-subtle">{formatMetric(row.recall)}</td>
                                <td className="border-end border-light-subtle">{formatMetric(row.f1)}</td>
                                <td>{row.support}</td>
                            </tr>
                        ))}
                    </tbody>
                    {accuracy !== undefined && (
                        <tfoot className="fw-bold bg-light">
                            <tr>
                                <td className="border-end border-light-subtle">accuracy</td>
                                <td colSpan={3} className="border-end border-light-subtle"></td>
                                <td>{formatMetric(accuracy)}</td>
                            </tr>
                        </tfoot>
                    )}
                </Table>
            ) : (
                <pre className="small bg-light p-3 rounded border border-light-subtle">{formatReport(report)}</pre>
            )}
        </div>
    );
};

const EmptyState = ({ children }) => (
    <div
        className="d-flex align-items-center justify-content-center text-muted"
        style={{
            minHeight: '200px',
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            background: '#fff'
        }}
    >
        <div className="text-center">
            <InfoCircle className="fs-3 mb-2 opacity-50" />
            <p className="mb-0 small fw-bold">{children}</p>
        </div>
    </div>
);

const TabTitle = ({ icon, children }) => (
    <span className="d-inline-flex align-items-center gap-2">
        {icon}
        {children}
    </span>
);

const MetricStrip = ({ training, onStopTraining, stoppingTraining, onRestartTraining, restartingTraining }) => {
    const accuracy = getTrainingAccuracy(training);

    const items = [
        { label: 'Version', value: training?.version, icon: <Hash /> },
        {
            label: 'Status',
            value: getTrainingStatusBadge(training?.status),
            icon: <Activity />,
            action: isTrainingActive(training) && onStopTraining ? (
                <Button
                    variant="link"
                    className="border-0 p-0 lh-1 text-primary text-decoration-none ms-auto"
                    aria-label="Stop training"
                    title="Stop training"
                    disabled={stoppingTraining}
                    onClick={onStopTraining}
                >
                    {stoppingTraining ? (
                        <Spinner animation="border" size="sm" />
                    ) : (
                        <StopCircleFill className="fs-4" />
                    )}
                </Button>
            ) : isTrainingReady(training) && onRestartTraining ? (
                <Button
                    variant="link"
                    className="border-0 p-0 lh-1 text-primary text-decoration-none ms-auto"
                    aria-label="Restart training"
                    title="Restart training"
                    disabled={restartingTraining}
                    onClick={onRestartTraining}
                >
                    {restartingTraining ? (
                        <Spinner animation="border" size="sm" />
                    ) : (
                        <ArrowClockwise className="fs-4" />
                    )}
                </Button>
            ) : null
        },
        { label: 'Started', value: training?.created_at, icon: <Clock /> },
        { label: 'Completed', value: training?.date_done || '-', icon: <Calendar3 /> },
        {
            label: 'Accuracy',
            value: training?.status === 'SUCCESS' && accuracy !== null ? (
                <span className="fw-bold">{(accuracy * 100).toFixed(2)}%</span>
            ) : '-',
            icon: <GraphUp />
        }
    ];

    return (
        <Row className="g-3 mt-1">
            {items.map((item, idx) => (
                <Col key={idx} xs={12} sm={6} md={4} lg={true}>
                    <Card className="h-100">
                        <Card.Body className="p-3 d-flex align-items-center">
                            <div className="text-primary me-3 fs-4">
                                {item.icon}
                            </div>
                            <div>
                                <div className="text-muted small fw-bold" style={{ fontSize: '0.65rem' }}>{item.label}</div>
                                <div className="text-dark small fw-medium">{item.value || '-'}</div>
                            </div>
                            {item.action}
                        </Card.Body>
                    </Card>
                </Col>
            ))}
        </Row>
    );
};

const ConfusionMatrix = ({ training, split }) => {
    const matrix = getConfusionMatrix(training, split);
    const report = getReport(training?.result, split);

    const labels = useMemo(() => reportRows(report)
        .filter(row => !['accuracy', 'macro avg', 'weighted avg'].includes(row.label))
        .map(row => row.label), [report]);

    const maxValue = useMemo(() => {
        if (!Array.isArray(matrix)) return 1;
        let max = 0;
        matrix.forEach(row => row.forEach(val => { if (val > max) max = val; }));
        return max || 1;
    }, [matrix]);

    if (!Array.isArray(matrix) || matrix.length === 0) {
        return <EmptyState>No confusion matrix available.</EmptyState>;
    }

    return (
        <div className="w-100 p-1">
            <div className="d-flex gap-2 align-items-stretch">
                <div className="flex-grow-1 overflow-auto rounded border border-light-subtle bg-white" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                    <Table hover size="sm" className="mb-0 text-center align-middle font-monospace small">
                        <thead className="sticky-top bg-white shadow-sm" style={{ zIndex: 10 }}>
                            <tr className="border-bottom border-light-subtle">
                                <th className="border-end border-light-subtle bg-light text-center p-0" 
                                    style={{ 
                                        width: '120px', 
                                        minWidth: '120px', 
                                        position: 'sticky', 
                                        left: 0, 
                                        zIndex: 11 
                                    }}>
                                    <div className="d-flex flex-column text-muted fw-bold p-1" style={{ fontSize: '0.55rem', lineHeight: 1.1 }}>
                                        <div className="text-end pe-1 border-bottom pb-1 mb-1">PREDICTED &rarr;</div>
                                        <div className="text-start ps-1">&darr; ACTUAL</div>
                                    </div>
                                </th>
                                {labels.map((label, i) => (
                                    <th key={i} className="px-2 py-2 border-end border-light-subtle bg-white fw-bold text-muted" title={label} style={{ minWidth: '80px' }}>
                                        <div className="text-truncate" style={{ maxWidth: '100px', fontSize: '0.7rem' }}>
                                            {label}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {matrix.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-bottom border-light-subtle">
                                    <td className="border-end border-light-subtle fw-bold text-muted text-end px-2 py-2 text-truncate bg-light" 
                                        style={{ 
                                            width: '120px', 
                                            minWidth: '120px', 
                                            position: 'sticky', 
                                            left: 0, 
                                            zIndex: 9,
                                            fontSize: '0.7rem'
                                        }} 
                                        title={labels[rowIndex]}>
                                        {labels[rowIndex]}
                                    </td>
                                    {row.map((value, colIndex) => {
                                        const intensity = value / maxValue;
                                        const bgColor = intensity === 0 ? '#fff' : `rgba(13, 110, 253, ${0.1 + intensity * 0.9})`;
                                        const textColor = intensity > 0.5 ? '#fff' : '#000';
                                        const isDiagonal = rowIndex === colIndex;
                                        return (
                                            <td
                                                key={colIndex}
                                                style={{
                                                    backgroundColor: bgColor,
                                                    color: textColor,
                                                    fontWeight: value > 0 ? 'bold' : 'normal',
                                                    transition: 'all 0.15s ease',
                                                    outline: isDiagonal && value > 0 ? '1px solid rgba(0,0,0,0.1)' : undefined,
                                                    outlineOffset: '-1px',
                                                    fontSize: '0.75rem'
                                                }}
                                                className="px-2 py-2 border-end border-light-subtle"
                                                title={`Actual: ${labels[rowIndex]} | Predicted: ${labels[colIndex]} | Count: ${value}`}
                                            >
                                                {value}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
                <div className="d-flex flex-column align-items-center py-2 me-2" style={{ width: '40px' }}>
                    <div className="text-muted fw-bold mb-1" style={{ fontSize: '0.6rem' }}>{maxValue}</div>
                    <div className="flex-grow-1 border border-light-subtle rounded" style={{
                        width: '10px',
                        background: 'linear-gradient(to top, rgba(13, 110, 253, 0.1), rgba(13, 110, 253, 1))'
                    }} />
                    <div className="text-muted fw-bold mt-1" style={{ fontSize: '0.6rem' }}>0</div>
                </div>
            </div>
        </div>
    );
};

const chartColors = [
    '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7'
];

const getDefaultSelectedMetrics = (metrics) => metrics;

const HistoryCharts = ({ history }) => {
    const metrics = useMemo(() => Object.keys(history || {}).filter(key => Array.isArray(history[key]) && history[key].length > 0), [history]);
    const [selectedMetrics, setSelectedMetrics] = useState(() => metrics);
    const [logScale, setLogScale] = useState(false);
    const [smoothing, setSmoothing] = useState(1);

    // Zoom state
    const [refAreaLeft, setRefAreaLeft] = useState('');
    const [refAreaRight, setRefAreaRight] = useState('');
    const [left, setLeft] = useState('dataMin');
    const [right, setRight] = useState('dataMax');

    useEffect(() => {
        setSelectedMetrics(metrics);
    }, [metrics]);

    const epochCount = useMemo(() => Math.max(...metrics.map(metric => history[metric].length), 0), [metrics, history]);

    const data = useMemo(() => {
        const raw = Array.from({ length: epochCount }, (_, i) => {
            const entry = { epoch: i + 1 };
            metrics.forEach(metric => {
                if (history[metric][i] !== undefined) entry[metric] = history[metric][i];
            });
            return entry;
        });

        if (smoothing <= 1) return raw;

        return raw.map((entry, index) => {
            const smoothed = { ...entry };
            metrics.forEach(metric => {
                const start = Math.max(0, index - smoothing + 1);
                const slice = raw.slice(start, index + 1).map(e => e[metric]).filter(v => v !== undefined);
                if (slice.length > 0) {
                    smoothed[metric] = slice.reduce((a, b) => a + b, 0) / slice.length;
                }
            });
            return smoothed;
        });
    }, [epochCount, metrics, history, smoothing]);

    const handleAllToggle = (checked) => {
        if (checked) {
            setSelectedMetrics(metrics);
        } else {
            setSelectedMetrics([metrics[0]]);
        }
    };

    const isAllSelected = selectedMetrics.length === metrics.length;

    const zoom = () => {
        if (refAreaLeft === refAreaRight || refAreaRight === '') {
            setRefAreaLeft('');
            setRefAreaRight('');
            return;
        }
        let l = refAreaLeft;
        let r = refAreaRight;
        if (l > r) [l, r] = [r, l];
        setLeft(l);
        setRight(r);
        setRefAreaLeft('');
        setRefAreaRight('');
    };

    const zoomOut = () => {
        setLeft('dataMin');
        setRight('dataMax');
        setRefAreaLeft('');
        setRefAreaRight('');
    };

    if (metrics.length === 0) return <EmptyState>No history data available.</EmptyState>;

    return (
        <Row className="mt-2 g-3" style={{ height: 'calc(100vh - 350px)' }}>
            <Col lg={2} className="h-100">
                <Card className="border-light h-100">
                    <Card.Body className="p-3 d-flex flex-column">
                        <Form.Check
                            type="checkbox"
                            id="select-all-metrics"
                            label={<span className="small fw-bold text-muted">All Metrics</span>}
                            checked={isAllSelected}
                            onChange={(e) => handleAllToggle(e.target.checked)}
                            className="mb-3"
                        />

                        <div className="flex-grow-1 overflow-auto mb-3">
                            {metrics.map((metric, index) => (
                                <Form.Check
                                    key={metric}
                                    type="radio"
                                    id={`metric-${metric}`}
                                    label={
                                        <div className="d-flex align-items-center justify-content-between gap-2">
                                            <span className="small text-truncate" title={metric}>{metric}</span>
                                            <span 
                                                style={{ 
                                                    width: '8px', 
                                                    height: '8px', 
                                                    borderRadius: '50%', 
                                                    backgroundColor: chartColors[index % chartColors.length],
                                                    display: 'inline-block',
                                                    flexShrink: 0
                                                }}
                                            />
                                        </div>
                                    }
                                    className="mb-2"
                                    checked={selectedMetrics.includes(metric)}
                                    onClick={() => {
                                        if (selectedMetrics.includes(metric)) {
                                            if (selectedMetrics.length > 1) {
                                                setSelectedMetrics(selectedMetrics.filter(m => m !== metric));
                                            }
                                        } else {
                                            setSelectedMetrics([...selectedMetrics, metric]);
                                        }
                                    }}
                                    onChange={() => { }} // dummy to avoid react warning
                                />
                            ))}
                        </div>

                        <div className="mt-auto border-top pt-3">
                            <Form.Group className="mb-3">
                                <Form.Label className="small text-muted fw-bold mb-1 d-flex justify-content-between">
                                    Smoothing <span>{smoothing}</span>
                                </Form.Label>
                                <Form.Range
                                    min={1}
                                    max={20}
                                    step={1}
                                    value={smoothing}
                                    onChange={(e) => setSmoothing(parseInt(e.target.value))}
                                />
                            </Form.Group>

                            <Form.Check
                                type="switch"
                                id="log-scale-y"
                                label={<span className="small text-muted fw-bold">Log Scale Y</span>}
                                checked={logScale}
                                onChange={(e) => setLogScale(e.target.checked)}
                            />
                        </div>
                    </Card.Body>
                </Card>
            </Col>
            <Col lg={10} className="h-100">
                <Card className="border-light h-100">
                    <Card.Body className="p-3 d-flex flex-column">
                        <div className="flex-grow-1" onDoubleClick={zoomOut}>
                            <ResponsiveContainer>
                                <LineChart
                                    data={data}
                                    margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                                    onMouseDown={(e) => e && setRefAreaLeft(e.activeLabel)}
                                    onMouseMove={(e) => e && refAreaLeft && setRefAreaRight(e.activeLabel)}
                                    onMouseUp={zoom}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                    <XAxis
                                        allowDataOverflow
                                        dataKey="epoch"
                                        domain={[left, right]}
                                        type="number"
                                        label={{ value: 'Epoch', position: 'insideBottom', offset: -10, className: 'small fw-bold text-muted', style: { fontSize: '0.65rem' } }}
                                        tick={{ fontSize: 10 }}
                                    />
                                    <YAxis
                                        allowDataOverflow
                                        scale={logScale ? 'log' : 'auto'}
                                        domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
                                        tick={{ fontSize: 10 }}
                                        label={{ value: 'Value', angle: -90, position: 'insideLeft', offset: 10, className: 'small fw-bold text-muted', style: { fontSize: '0.65rem' } }}
                                    />
                                    <RechartsTooltip
                                        contentStyle={{ fontSize: '11px', border: '1px solid #dee2e6', borderRadius: '4px' }}
                                        itemStyle={{ padding: '1px 0' }}
                                    />
                                    {selectedMetrics.map((metric, index) => (
                                        <Line
                                            key={metric}
                                            type="monotone"
                                            dataKey={metric}
                                            stroke={chartColors[metrics.indexOf(metric) % chartColors.length]}
                                            dot={false}
                                            activeDot={{ r: 4, strokeWidth: 0 }}
                                            strokeWidth={2}
                                            isAnimationActive={false}
                                        />
                                    ))}
                                    {refAreaLeft && refAreaRight ? (
                                        <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#0d6efd" fillOpacity={0.1} />
                                    ) : null}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </Card.Body>
                </Card>
            </Col>
        </Row>
    );
};

const ReportsPanel = ({ training }) => {
    const report = getTrainingReport(training);

    return (
        <Tabs defaultActiveKey="train-report" variant="pills" className="mb-3 border-0 small">
            <Tab eventKey="train-report" title="Train">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                    <ReportTable title="Training Data Metrics" report={report?.train} />
                </div>
            </Tab>
            <Tab eventKey="test-report" title="Test">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                    <ReportTable title="Test Data Metrics" report={report?.test} />
                </div>
            </Tab>
        </Tabs>
    );
};

const ConfusionMatrixPanel = ({ training }) => (
    <Tabs defaultActiveKey="train-matrix" variant="pills" className="mb-3 border-0 small">
        <Tab eventKey="train-matrix" title="Train">
            <ConfusionMatrix training={training} split="train" />
        </Tab>
        <Tab eventKey="test-matrix" title="Test">
            <ConfusionMatrix training={training} split="test" />
        </Tab>
    </Tabs>
);

const TrainingSummary = ({ training }) => {
    const report = getTrainingReport(training);

    return (
        <pre className="p-3 mb-0 bg-light border-0 rounded small overflow-auto" style={{ height: 'calc(100vh - 400px)', whiteSpace: 'pre-wrap' }}>
            {report?.summary || 'No model summary available.'}
        </pre>
    );
};

const TrainingPlots = ({ training }) => {
    const report = getTrainingReport(training);

    return <HistoryCharts history={report?.history} />;
};

const formatParameterValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
};

const TrainingParameters = ({ training }) => {
    const parameters = training?.kwargs || {};
    const entries = Object.entries(parameters);

    if (entries.length === 0) {
        return <EmptyState>No training parameters available.</EmptyState>;
    }

    return (
        <div className="overflow-auto" style={{ height: 'calc(100vh - 400px)' }}>
            <Table responsive hover size="sm" className="mb-0 small align-middle border-light-subtle">
                <thead className="sticky-top">
                    <tr>
                        <th style={{ width: '240px' }}>Parameter</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(([key, value]) => (
                        <tr key={key}>
                            <td className="fw-bold text-muted small text-capitalize">{key.replace(/_/g, ' ')}</td>
                            <td className="font-monospace">
                                {typeof value === 'object' && value !== null ? (
                                    <pre className="mb-0 bg-transparent p-0 border-light-subtle">{formatParameterValue(value)}</pre>
                                ) : (
                                    formatParameterValue(value)
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
};

const TrainingInspector = ({ training, previousTraining, trainingData, previousTrainingData }) => {
    const defaultTab = training.status === 'FAILURE' ? 'traceback' : 'changes';
    const report = getTrainingReport(training);
    const hasSummary = Boolean(report?.summary);
    const hasHistory = Boolean(report?.history && Object.keys(report.history).length > 0);

    return (
        <div className="border border-light-subtle rounded mt-4 bg-white overflow-hidden">
            <Tabs defaultActiveKey={defaultTab} className="border-bottom border-light-subtle custom-tabs">
                <Tab
                    eventKey="changes"
                    title={<TabTitle icon={<FileDiff />}>Data</TabTitle>}
                >
                    <div className="p-3">
                        <div className="border border-light-subtle rounded overflow-hidden">
                            <SimpleDiffViewer
                                oldValue={previousTrainingData}
                                newValue={trainingData}
                                oldVersion={previousTraining?.version || '0'}
                                newVersion={training.version}
                            />
                        </div>
                    </div>
                </Tab>
                <Tab
                    eventKey="reports"
                    title={<TabTitle icon={<Clipboard />}>Reports</TabTitle>}
                    disabled={training.status !== 'SUCCESS'}
                >
                    <div className="p-3">
                        <ReportsPanel training={training} />
                    </div>
                </Tab>
                <Tab
                    eventKey="matrix"
                    title={<TabTitle icon={<Grid />}>Matrix</TabTitle>}
                    disabled={training.status !== 'SUCCESS'}
                >
                    <div className="p-3">
                        <ConfusionMatrixPanel training={training} />
                    </div>
                </Tab>
                <Tab
                    eventKey="summary"
                    title={<TabTitle icon={<FileText />}>Summary</TabTitle>}
                    disabled={!hasSummary && training.status !== 'SUCCESS'}
                >
                    <div className="p-3">
                        <TrainingSummary training={training} />
                    </div>
                </Tab>
                <Tab
                    eventKey="plots"
                    title={<TabTitle icon={<BarChart />}>Plots</TabTitle>}
                    disabled={!hasHistory && training.status !== 'SUCCESS'}
                >
                    <div className="p-3">
                        <TrainingPlots training={training} />
                    </div>
                </Tab>
                <Tab
                    eventKey="parameters"
                    title={<TabTitle icon={<Sliders />}>Parameters</TabTitle>}
                >
                    <div className="p-3">
                        <TrainingParameters training={training} />
                    </div>
                </Tab>
                <Tab
                    eventKey="traceback"
                    title={<TabTitle icon={<Bug />}>Error</TabTitle>}
                    disabled={training.status !== 'FAILURE'}
                >
                    <div className="p-3">
                        <pre className="p-3 mb-0 bg-danger bg-opacity-10 text-danger border-0 rounded small overflow-auto" style={{ height: 'calc(100vh - 400px)' }}>
                            {training.traceback || 'No traceback available.'}
                        </pre>
                    </div>
                </Tab>
            </Tabs>
        </div>
    );
};

const TrainingVersion = () => {
    const { modelId, trainingId } = useParams();
    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);
    const socket = useSocket();

    const [alert, setAlert] = useState(null);
    const [training, setTraining] = useState(null);
    const [previousTraining, setPreviousTraining] = useState(null);
    const [trainingData, setTrainingData] = useState('');
    const [previousTrainingData, setPreviousTrainingData] = useState('');
    const [loading, setLoading] = useState(false);
    const [stoppingTraining, setStoppingTraining] = useState(false);
    const [restartingTraining, setRestartingTraining] = useState(false);
    const [showRestartConfirmation, setShowRestartConfirmation] = useState(false);
    const roomRef = useRef(null);
    const trainingStatusRef = useRef(null);
    const trainingTaskId = training?.task_id;
    const trainingStatus = training?.status;

    const handleDownload = async () => {
        try {
            const response = await axios.get(`/api/models/${modelId}/trainings/${training.id}?format=zip`, {
                responseType: 'blob',
                headers: {
                    "Authorization": `Bearer ${user.token}`
                }
            });
            const href = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = href;
            link.download = `${model?.name || 'model'}_${training.version}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        }
    };

    const handleStopTraining = async () => {
        if (!training || !isTrainingActive(training)) return;

        try {
            setStoppingTraining(true);
            const response = await axios.post(
                `/api/models/${modelId}/trainings/${training.id}/stop`,
                {},
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setTraining(prev => ({
                ...prev,
                ...response.data,
                task_id: response.data.task_id || prev?.task_id
            }));
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        } finally {
            setStoppingTraining(false);
        }
    };

    const handleCloseRestartConfirmation = () => {
        setShowRestartConfirmation(false);
    };

    const handleRestartTraining = async () => {
        if (!training || !isTrainingReady(training)) return;

        try {
            setRestartingTraining(true);
            const response = await axios.post(
                `/api/models/${modelId}/trainings/${training.id}/start`,
                training.kwargs || {},
                {
                    headers: {
                        "Authorization": `Bearer ${user.token}`
                    }
                }
            );
            setTraining(response.data);
            handleCloseRestartConfirmation();
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        } finally {
            setRestartingTraining(false);
        }
    };

    useEffect(() => {
        if (user && modelId && trainingId) {
            const getTraining = async () => {
                try {
                    setLoading(true);
                    const headers = { "Authorization": `Bearer ${user.token}` };
                    
                    // Fetch current training
                    const trainingResponse = await axios.get(`/api/models/${modelId}/trainings/${trainingId}`, {
                        params: { extended: '1' },
                        headers
                    });
                    const currentTraining = trainingResponse.data;
                    setTraining(currentTraining);

                    // Fetch trainings list to find previous
                    const listResponse = await axios.get(`/api/models/${modelId}/trainings`, {
                        params: { extended: '1', per_page: 100 },
                        headers
                    });
                    
                    const allTrainings = listResponse.data.trainings || [];
                    const currentIndex = allTrainings.findIndex(t => t.id === currentTraining.id);
                    let previous = null;
                    if (currentIndex !== -1 && currentIndex < allTrainings.length - 1) {
                        previous = allTrainings[currentIndex + 1];
                    }
                    setPreviousTraining(previous);

                    // Fetch data for diff
                    const dataPromises = [
                        axios.get(`/api/models/${modelId}/trainings/${trainingId}/data`, { headers }).then(res => res.data)
                    ];
                    if (previous) {
                        dataPromises.push(axios.get(`/api/models/${modelId}/trainings/${previous.id}/data`, { headers }).then(res => res.data));
                    }

                    const [currentData, prevData] = await Promise.all(dataPromises);
                    setTrainingData(currentData);
                    setPreviousTrainingData(prevData || '');

                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
                } finally {
                    setLoading(false);
                }
            };
            getTraining();
        }
    }, [user, modelId, trainingId]);

    useEffect(() => {
        trainingStatusRef.current = trainingStatus;
    }, [trainingStatus]);

    useEffect(() => {
        if (!user || !socket || !socket.connected || !TRAINING_ACTIVE_STATUSES.includes(trainingStatusRef.current)) return;
        const taskId = trainingTaskId;
        if (!taskId || roomRef.current === taskId) return;

        const handleStatus = (data) => {
            if (data.task_id !== taskId) return;

            setTraining(prev => ({ ...prev, ...data }));
            if (TRAINING_DONE_STATUSES.includes(data.status)) {
                socket.emit('leave', user.token, data.task_id);
                roomRef.current = null;
            }
        };

        socket.on('status', handleStatus);
        socket.emit('join', user.token, taskId);
        roomRef.current = taskId;

        return () => {
            socket.off('status', handleStatus);
            if (roomRef.current === taskId) {
                socket.emit('leave', user.token, taskId);
                roomRef.current = null;
            }
        };
    }, [user, socket, trainingTaskId]);

    return (
        <div className="pb-5 container-fluid">
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            {loading ? (
                <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '40vh' }}>
                    <Spinner animation='border' variant="secondary" />
                </div>
            ) : training && (
                <>
                    <MetricStrip
                        training={training}
                        onStopTraining={handleStopTraining}
                        stoppingTraining={stoppingTraining}
                        onRestartTraining={() => setShowRestartConfirmation(true)}
                        restartingTraining={restartingTraining}
                    />
                    <TrainingInspector 
                        training={training} 
                        previousTraining={previousTraining} 
                        trainingData={trainingData}
                        previousTrainingData={previousTrainingData}
                    />
                    <Modal centered show={showRestartConfirmation} onHide={handleCloseRestartConfirmation}>
                        <Modal.Header closeButton>
                            <Modal.Title className="small fw-bold text-muted">Restart training</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                            <p className="small">
                                Restarting this training will erase the current training results and replace them with the new run.
                            </p>
                            <div className="d-flex justify-content-end gap-2">
                                <Button
                                    variant="light"
                                    size="sm"
                                    onClick={handleCloseRestartConfirmation}
                                    className="border small"
                                    disabled={restartingTraining}
                                >
                                    CANCEL
                                </Button>
                                <Button
                                    variant="warning"
                                    size="sm"
                                    disabled={restartingTraining}
                                    onClick={handleRestartTraining}
                                    className="small"
                                >
                                    {restartingTraining ? (
                                        <><Spinner animation="border" size="sm" />&nbsp;RESTARTING...</>
                                    ) : (
                                        'RESTART'
                                    )}
                                </Button>
                            </div>
                        </Modal.Body>
                    </Modal>
                </>
            )}
        </div>
    );
};


const History = () => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);
    const { model } = useContext(ModelContext);

    const socket = useSocket();

    const [paramters, setParameters] = useState(getDefaultParameters(model?.type));
    const [query, setQuery] = useState('');
    const [alert, setAlert] = useState(null);
    const [trainings, setTrainings] = useState([]);
    const [currentTraining, setCurrentTraining] = useState(null);
    const [activeTrainings, setActiveTrainings] = useState([]);
    const [showParameters, setShowParameters] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [selectedTraining, setSelectedTraining] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [stoppingTrainingIds, setStoppingTrainingIds] = useState(new Set());
    const [restartingTrainingIds, setRestartingTrainingIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const pageRef = useRef(page);
    const [total, setTotal] = useState(0);
    const perPage = 7;
    const maxVisiblePages = 5;

    const debouncedQuery = useDebounce(query, 500);

    const rooms = useRef(new Set())
    const hasActiveTraining = activeTrainings.length > 0;
    const activeTrainingTaskIds = useMemo(
        () => activeTrainings
            .filter(isTrainingActive)
            .map(training => training.task_id)
            .filter(Boolean),
        [activeTrainings]
    );
    const activeTrainingTaskKey = activeTrainingTaskIds.join('|');
    const activeTrainingStatus = activeTrainings.some(training => training.status === 'STARTED')
        ? 'STARTED'
        : activeTrainings[0]?.status;

    const syncActiveTraining = (training) => {
        if (!training) return;
        setActiveTrainings(prev => {
            const withoutTraining = prev.filter(item =>
                item.id !== training.id && item.task_id !== training.task_id
            );
            return isTrainingActive(training) ? [training, ...withoutTraining] : withoutTraining;
        });
    };

    const updateTraining = (data) => {
        let nextTraining = null;
        setTrainings(prev => prev.map(training => {
            if (training.id !== data.id && training.task_id !== data.task_id) return training;
            nextTraining = mergeTraining(training, data);
            return nextTraining;
        }));
        setCurrentTraining(prev => {
            if (!prev || (prev.id !== data.id && prev.task_id !== data.task_id)) return prev;
            const mergedTraining = mergeTraining(prev, data);
            nextTraining = mergedTraining;
            return mergedTraining;
        });
        setActiveTrainings(prev => {
            let matched = false;
            const updated = prev.map(training => {
                if (training.id !== data.id && training.task_id !== data.task_id) return training;
                matched = true;
                return mergeTraining(training, data);
            });
            const candidate = nextTraining || (matched ? null : data);
            const next = candidate ? [candidate, ...updated] : updated;
            const deduped = next.filter((training, index, list) =>
                training && list.findIndex(item => item.id === training.id) === index
            );
            return deduped.filter(isTrainingActive);
        });
    };

    useEffect(() => {
        setParameters(getDefaultParameters(model?.type));
    }, [model?.type]);

    const architectureOptions = ARCHITECTURES_BY_MODEL[model?.type || 'text_classification'] || ['deep_neural_network'];
    const monitorOptions = paramters.architecture === 'transformer' && model?.type !== 'text_classification'
        ? [
            ['loss', 'loss'],
            ['val_loss', 'validation loss']
        ]
        : [
            ['accuracy', 'accuracy'],
            ['loss', 'loss'],
            ['val_accuracy', 'validation accuracy'],
            ['val_loss', 'validation loss']
        ];

    const handleArchitectureChange = (architecture) => {
        const defaults = ARCHITECTURE_DEFAULTS[architecture];
        const params = {};
        Object.keys(defaults).forEach(key => {
            params[key] = defaults[key].default;
        });
        setParameters({
            ...params,
            save_format: paramters.save_format
        });
    };

    const updateParameter = (field, value) => {
        setParameters(prev => ({ ...prev, [field]: value }));
    };

    const renderNumberControl = (field, label, options = {}) => {
        const metadata = ARCHITECTURE_DEFAULTS[paramters.architecture]?.[field] || {};
        const {
            min = metadata.min,
            max = metadata.max,
            step = metadata.step,
            parse = (metadata.step && metadata.step >= 1) ? parseInt : parseFloat,
            disabled = false
        } = options;

        return (
            <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                <Form.Label column sm="4" className="small fw-bold text-muted">
                    {label}&nbsp;<QuestionCircle />
                </Form.Label>
                <Col sm="6">
                    <Form.Range
                        disabled={disabled}
                        min={min}
                        max={max}
                        step={step}
                        value={paramters[field]}
                        onChange={(e) => updateParameter(field, parse(e.target.value))}
                    />
                </Col>
                <Col sm="2">
                    <Form.Control
                        disabled={disabled}
                        type='number'
                        min={min}
                        max={max}
                        step={step}
                        value={paramters[field]}
                        className="form-control-sm"
                        onChange={(e) => updateParameter(field, parse(e.target.value))}
                    />
                </Col>
            </FormGroup>
        );
    };

    const handleTrain = async () => {
        try {
            const headers = { "Authorization": `Bearer ${user.token}` };
            let response = await axios.post(`/api/models/${modelId}/trainings`, {}, { headers });
            response = await axios.post(`/api/models/${modelId}/trainings/${response.data.id}/start`, paramters, { headers });
            setCurrentTraining(response.data);
            syncActiveTraining(response.data);
            if (page === 1) {
                if (total + 1 > perPage) {
                    setTrainings(prev => [response.data, ...prev.slice(0, -1)]);
                } else {
                    setTrainings(prev => [response.data, ...prev]);
                    setTotal(total + 1)
                }
            } else {
                setPage(1);
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        }
    };

    const handleDownload = async (training) => {
        try {
            const response = await axios.get(`/api/models/${model.id}/trainings/${training.id}?format=zip`, {
                responseType: 'blob',
                headers: {
                    "Authorization": `Bearer ${user.token}`
                }
            });
            const href = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = href;
            link.download = `${model.name}_${training.version}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        }
    };

    const handleStopTraining = async (training) => {
        if (!training || !isTrainingActive(training)) return;

        try {
            setStoppingTrainingIds(prev => new Set(prev).add(training.id));
            const headers = { "Authorization": `Bearer ${user.token}` };
            const response = await axios.post(
                `/api/models/${modelId}/trainings/${training.id}/stop`,
                {},
                { headers }
            );
            updateTraining(response.data);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        } finally {
            setStoppingTrainingIds(prev => {
                const next = new Set(prev);
                next.delete(training.id);
                return next;
            });
        }
    };

    const handleRestartTraining = async (training) => {
        if (!training || !isTrainingReady(training)) return;

        try {
            setRestartingTrainingIds(prev => new Set(prev).add(training.id));
            const headers = { "Authorization": `Bearer ${user.token}` };
            const response = await axios.post(
                `/api/models/${modelId}/trainings/${training.id}/start`,
                training.kwargs || {},
                { headers }
            );
            updateTraining(response.data);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        } finally {
            setRestartingTrainingIds(prev => {
                const next = new Set(prev);
                next.delete(training.id);
                return next;
            });
        }
    };

    const handleOpenDeleteConfirmation = (training) => {
        setSelectedTraining(training);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setSelectedTraining(null);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async (trainingId) => {
        try {
            setSubmitting(true);
            setLoading(true);
            const headers = { "Authorization": `Bearer ${user.token}` }
            await axios.delete(`/api/models/${model.id}/trainings/${trainingId}`, { headers });
            setActiveTrainings(prev => prev.filter(training => training.id !== trainingId));
            if (trainings.length - 1 > 0) {
                if (page === Math.ceil((total) / perPage)) {
                    if (page === 1 && trainingId === currentTraining?.id)
                        setCurrentTraining(trainings[1])
                    setTrainings(prev => prev.filter((t) => t.id !== trainingId));
                    setTotal(total - 1);
                } else {
                    let params = { extended: '1', page: page, per_page: perPage };
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${model.id}/trainings`, { params, headers });
                    setTrainings(response.data.trainings);
                    setTotal(response.data.total);
                    if (trainingId === currentTraining?.id)
                        setCurrentTraining(response.data.trainings[0]);
                }
            } else {
                if (page > 1) {
                    setPage(page - 1);
                } else {
                    if (trainingId === currentTraining?.id)
                        setCurrentTraining(null);
                    setTrainings([]);
                    setTotal(0);
                }
            }
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response.data.error });
        } finally {
            handleCloseDeleteConfirmation();
            setLoading(false);
            setSubmitting(false);
        }
    };

    useEffect(() => {
        pageRef.current = page;
    }, [page]);

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery])

    useEffect(() => {
        if (user && modelId) {
            const getTrainings = async () => {
                try {
                    setLoading(true)
                    let params = { extended: '1', page: page, per_page: perPage };
                    if (debouncedQuery) params.query = debouncedQuery;
                    const headers = { "Authorization": `Bearer ${user.token}` };
                    const [response, activeResponse] = await Promise.all([
                        axios.get(`/api/models/${modelId}/trainings`, { params, headers }),
                        axios.get(`/api/models/${modelId}/trainings`, {
                            params: { extended: '1', page: 1, per_page: 1000 },
                            headers
                        })
                    ]);
                    setActiveTrainings((activeResponse.data.trainings || []).filter(isTrainingActive));
                    if (response.data.total > 0) {
                        setTrainings(response.data.trainings);
                        setTotal(response.data.total);
                        if (page === 1 && debouncedQuery === '')
                            setCurrentTraining(response.data.trainings[0])
                    } else {
                        setTrainings([]);
                        setTotal(0);
                        if (page === 1 && debouncedQuery === '')
                            setCurrentTraining(null);
                    }
                    setLoading(false)
                } catch (error) {
                    setAlert({ variant: 'danger', message: error.response.data.error });
                }
            };
            getTrainings();
        }
    }, [user, modelId, page, perPage, debouncedQuery]);

    useEffect(() => {
        if (!user || !socket || !socket.connected || activeTrainingTaskIds.length === 0) return;
        const activeRooms = rooms.current;

        const handleStatus = (data) => {
            if (!activeRooms.has(data.task_id)) return;

            updateTraining(data);
            if (TRAINING_DONE_STATUSES.includes(data.status)) {
                socket.emit('leave', user.token, data.task_id);
                rooms.current.delete(data.task_id);
            }
        };

        socket.on('status', handleStatus);
        activeTrainingTaskIds.forEach(taskId => {
            if (!activeRooms.has(taskId)) {
                socket.emit('join', user.token, taskId);
                activeRooms.add(taskId);
            }
        });

        return () => {
            socket.off('status', handleStatus);
            activeTrainingTaskIds.forEach(taskId => {
                socket.emit('leave', user.token, taskId);
                activeRooms.delete(taskId);
            });
        };
    }, [user, socket, activeTrainingTaskKey]);

    return (
        <div className="container-fluid">
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <ButtonGroup>
                        <Button
                            variant="light"
                            className="border"
                            onClick={() => setShowParameters(true)}
                        >
                            <Sliders />
                        </Button>
                        {hasActiveTraining ?
                            <>
                                {activeTrainingStatus === 'PENDING' || activeTrainingStatus === 'RECEIVED' ?
                                    <Button
                                        variant="light"
                                        disabled
                                        className="border"
                                    >
                                        <Spinner
                                            animation="border"
                                            size="sm"
                                        />
                                            &nbsp;pending...
                                        </Button>
                                    : activeTrainingStatus === 'STARTED' ?
                                        <Button
                                            variant="light"
                                            disabled
                                            className="border"
                                        >
                                            <Spinner
                                                animation="grow"
                                                size="sm"
                                            />
                                            &nbsp;training...
                                        </Button>
                                        : null}
                            </>
                            :
                            <Button
                                variant="light"
                                onClick={handleTrain}
                                className="border"
                            >
                                <ArrowClockwise />&nbsp;start training
                            </Button>}
                    </ButtonGroup>
                </Col>
                <Col>
                    <Form>
                        <Form.Control
                            type="text"
                            placeholder="search for trainings..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </Form>
                </Col>
            </Row>
            <Row className="mt-4">
                <Col>
                    <Table
                        responsive
                        hover
                        style={{
                            minHeight: '33vh',
                            textAlign: 'center'
                        }}
                    >
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Version</th>
                                <th>Status</th>
                                <th>Date Start</th>
                                <th>Date Done</th>
                                <th>Accuracy (%)</th>
                                <th>Options</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr >
                                    <td
                                        colSpan={7}
                                        style={{
                                            verticalAlign: 'middle'
                                        }}
                                    >
                                        <Spinner animation='border' size='lg' />
                                    </td>
                                </tr>
                            ) : total > 0 ?
                                trainings.map((training, index) => (
                                    <tr key={training.id}>
                                        <td>{(page - 1) * perPage + index + 1}.</td>
                                        <td>
                                            <Link to={`/models/${modelId}/history/${training.id}`} className="text-decoration-none">
                                                {training.version}
                                            </Link>
                                        </td>
                                        <td>{getTrainingStatusBadge(training.status)}</td>
                                        <td>{training.created_at}</td>
                                        <td>{training.date_done}</td>
                                        <td>{training.status === 'SUCCESS' && getTrainingAccuracy(training) !== null && (getTrainingAccuracy(training) * 100).toFixed(2)}</td>
                                        <td>
                                            <Dropdown>
                                                <Dropdown.Toggle size='sm' variant='light'>
                                                    select
                                                </Dropdown.Toggle>
                                                <Dropdown.Menu>
                                                    {isTrainingActive(training) && (
                                                        <Dropdown.Item
                                                            disabled={stoppingTrainingIds.has(training.id)}
                                                            onClick={() => handleStopTraining(training)}
                                                        >
                                                            {stoppingTrainingIds.has(training.id) ? (
                                                                <Spinner animation="border" size="sm" className="me-2" />
                                                            ) : (
                                                                <StopCircleFill className="me-2" />
                                                            )}
                                                            Stop
                                                        </Dropdown.Item>
                                                    )}
                                                    {isTrainingReady(training) && (
                                                        <Dropdown.Item
                                                            disabled={restartingTrainingIds.has(training.id)}
                                                            onClick={() => handleRestartTraining(training)}
                                                        >
                                                            {restartingTrainingIds.has(training.id) ? (
                                                                <Spinner animation="border" size="sm" className="me-2" />
                                                            ) : (
                                                                <ArrowClockwise className="me-2" />
                                                            )}
                                                            Retry
                                                        </Dropdown.Item>
                                                    )}
                                                    <Dropdown.Item
                                                        disabled={!isTrainingDeletable(training)}
                                                        className="text-danger"
                                                        onClick={() => handleOpenDeleteConfirmation(training)}
                                                    >
                                                        <Trash className="me-2" />
                                                        Delete
                                                    </Dropdown.Item>
                                                </Dropdown.Menu>
                                            </Dropdown>
                                        </td>
                                    </tr>
                                )) : query !== '' ? (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            style={{
                                                verticalAlign: 'middle'
                                            }}
                                        >
                                            <i className="bi bi-ban" />&nbsp;could not find the training you are looking for.
                                        </td>
                                    </tr>
                                ) : (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            style={{
                                                verticalAlign: 'middle'
                                            }}
                                        >
                                            <InfoCircle />&nbsp;looks like you have no trainings.
                                        </td>
                                    </tr>
                                )}
                        </tbody>
                    </Table>
                    <br></br>
                    {total > perPage &&
                        <Pagination className="justify-content-start">
                            <Pagination.Prev
                                onClick={() => setPage((prevPage) => Math.max(prevPage - 1, 1))}
                                disabled={page === 1}
                            />
                            {[...Array(Math.ceil(total / perPage))].map((_, i) => (
                                (i === 0 || i === Math.ceil(total / perPage) - 1 || (i >= page - Math.floor(maxVisiblePages / 2) && i <= page + Math.floor(maxVisiblePages / 2))) ? (
                                    <Pagination.Item
                                        key={i + 1}
                                        active={i + 1 === page}
                                        onClick={() => setPage(i + 1)}
                                    >
                                        {i + 1}
                                    </Pagination.Item>
                                ) : (i === page - Math.floor(maxVisiblePages / 2) - 1 || i === page + Math.floor(maxVisiblePages / 2) + 1 ?
                                    <Pagination.Ellipsis key={`ellipsis-${i}`} /> : null
                                )
                            ))}
                            <Pagination.Next
                                onClick={() => setPage((prevPage) => Math.min(prevPage + 1, Math.ceil(total / perPage)))}
                                disabled={page === Math.ceil(total / perPage)}
                            />
                        </Pagination>}
                </Col>
            </Row>
            <Modal size="lg" centered show={showParameters} onHide={() => setShowParameters(false)}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">
                        Parameters&nbsp;
                        <OverlayTrigger
                            placement='bottom'
                            overlay={
                                <Popover>
                                    <Popover.Header as="h3"><InfoCircle />&nbsp;Parameters</Popover.Header>
                                    <Popover.Body>
                                        Configurations set before training which influence the learning process. <strong>Only saved after training is completed successfully.</strong>
                                    </Popover.Body>
                                </Popover>
                            }
                        >
                            <QuestionCircle />
                        </OverlayTrigger>
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4" className="small fw-bold text-muted">
                                Architecture&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm="4">
                                <Form.Select
                                    value={paramters.architecture}
                                    onChange={(e) => handleArchitectureChange(e.target.value)}
                                    className="form-select-sm"
                                >
                                    {architectureOptions.map((architecture) => (
                                        <option key={architecture} value={architecture}>{architecture}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                        </FormGroup>
                        {paramters.architecture === 'transformer' && (
                            <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                                <Form.Label column sm="4" className="small fw-bold text-muted">
                                    Pretrained model&nbsp;<QuestionCircle />
                                </Form.Label>
                                <Col sm="6">
                                    <Form.Select
                                        value={paramters.pretrained_model}
                                        onChange={(e) => updateParameter('pretrained_model', e.target.value)}
                                        className="form-select-sm"
                                    >
                                        {PRETRAINED_MODELS.map((pretrainedModel) => (
                                            <option key={pretrainedModel} value={pretrainedModel}>{pretrainedModel}</option>
                                        ))}
                                    </Form.Select>
                                </Col>
                            </FormGroup>
                        )}
                        {renderNumberControl('validation_split', 'Validation split')}
                        {renderNumberControl('epochs', 'Epochs')}
                        {renderNumberControl('batch_size', 'Batch size')}
                        {['deep_neural_network', 'recurrent_neural_network'].includes(paramters.architecture) && renderNumberControl('max_tokens', 'Max tokens')}
                        {['deep_neural_network', 'recurrent_neural_network'].includes(paramters.architecture) && renderNumberControl('sequence_length', 'Sequence length')}
                        {['deep_neural_network', 'recurrent_neural_network'].includes(paramters.architecture) && renderNumberControl('embedding_dims', 'Embedding dimensions')}
                        {paramters.architecture === 'recurrent_neural_network' && renderNumberControl('lstm_dims', 'LSTM dimensions')}
                        {paramters.architecture === 'transformer' && renderNumberControl('max_seq_len', 'Max sequence length')}
                        {paramters.architecture === 'transformer' && renderNumberControl('learning_rate', 'Learning rate')}
                        {paramters.architecture === 'transformer' && renderNumberControl('weight_decay_rate', 'Weight decay')}
                        {paramters.architecture === 'transformer' && renderNumberControl('num_warmup_steps', 'Warmup steps')}
                        {paramters.architecture === 'transformer' && model?.type !== 'named_entity_recognition' && renderNumberControl('units', 'Dense units')}
                        {paramters.architecture !== 'transformer' || model?.type !== 'named_entity_recognition'
                            ? renderNumberControl('dropout', 'Dropout')
                            : null}
                        {paramters.architecture === 'transformer' && model?.type !== 'named_entity_recognition' && renderNumberControl('l2', 'L2 regularization')}
                        {paramters.architecture === 'transformer' && (
                            <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                                <Form.Label column sm="4" className="small fw-bold text-muted">
                                    Trainable encoder&nbsp;<QuestionCircle />
                                </Form.Label>
                                <Col sm='8'>
                                    <Form.Check
                                        type='switch'
                                        onChange={(e) => updateParameter('trainable', e.target.checked)}
                                        checked={Boolean(paramters.trainable)}
                                    />
                                </Col>
                            </FormGroup>
                        )}
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm="4" className="small fw-bold text-muted">
                                Early stopping&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='8'>
                                <Form.Check
                                    type='switch'
                                    onChange={(e) => updateParameter('early_stopping', e.target.checked)}
                                    checked={paramters.early_stopping}
                                />
                            </Col>
                        </FormGroup>
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm='4' className="small fw-bold text-muted">
                                Monitor&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='4'>
                                <Form.Select
                                    disabled={!paramters.early_stopping}
                                    value={paramters.monitor}
                                    onChange={(e) => updateParameter('monitor', e.target.value)}
                                    className="form-select-sm"
                                >
                                    {monitorOptions.map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                        </FormGroup>
                        {renderNumberControl('patience', 'Patience', { disabled: !paramters.early_stopping })}
                        <FormGroup className="mt-3 d-flex align-items-center justify-text-center" as={Row}>
                            <Form.Label column sm='4' className="small fw-bold text-muted">
                                Save format&nbsp;<QuestionCircle />
                            </Form.Label>
                            <Col sm='4'>
                                <Form.Select
                                    value={paramters.save_format}
                                    onChange={(e) => updateParameter('save_format', e.target.value)}
                                    className="form-select-sm"
                                >
                                    <option value='tf'>tf</option>
                                    <option value='saved_model'>saved_model</option>
                                    <option value='h5'>h5</option>
                                    <option value='weights'>weights</option>
                                    <option value='tflite'>tflite</option>
                                    <option value='onnx'>onnx</option>
                                </Form.Select>
                            </Col>
                        </FormGroup>
                    </Form>
                </Modal.Body>
            </Modal>
            <Modal centered show={showDeleteConfirmation} onHide={handleCloseDeleteConfirmation}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">Delete training</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="small">Are you sure you want to delete this training record?</p>
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" onClick={handleCloseDeleteConfirmation} className="border small">CANCEL</Button>
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={submitting}
                            onClick={() => handleDelete(selectedTraining.id)}
                            className="small"
                        >
                            {submitting ? (
                                <><Spinner animation="border" size="sm" />&nbsp;DELETING...</>
                            ) : (
                                'DELETE'
                            )}
                        </Button>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}

export { TrainingVersion };
export default History;
