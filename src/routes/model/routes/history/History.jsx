import { useContext, useEffect, useState, useRef, useMemo } from "react";
import { Alert, Button, ButtonGroup, ButtonToolbar, Col, Row, Form, Spinner, Table, Pagination, Modal, Tabs, Tab, Badge, Card, InputGroup } from "react-bootstrap";
import {
    BarChart,
    Bug,
    Clipboard,
    Download,
    PlusSlashMinus,
    Stack,
    Grid3x3Gap,
    InfoCircle,
    Sliders,
    Trash,
    ArrowClockwise,
    Hash,
    Activity,
    Calendar3,
    Check2Circle,
    Clock,
    GraphUp,
    ZoomIn,
    ArrowRepeat,
    StopCircleFill,
    PlusLg,
    BarChartFill,
    Sliders2,
    Grid3x3GapFill,
    BugFill,
    ListColumnsReverse,
    ClockHistory,
    Search,
    ArrowCounterclockwise,
    FiletypeCsv,
    FiletypePng,
    Collection
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
import { UserContext } from "../../../../contexts/UserContext";
import { ModelContext } from "../../../../contexts/ModelContext";
import { useSocket } from "../../../../contexts/SocketContext";
import { CardHeading, EmptyMessage } from "../../../../shared/components/SectionCard";
import downloadBlob from "../../../../shared/utils/downloadBlob";
import chartPng from "../../../../shared/utils/chartPng";
import { getReport, getTrainingAccuracy, getConfusionMatrix, reportRows } from "../../../../shared/utils/training";
import { Link, useParams } from "react-router-dom";
import useDebounce from "../../../../shared/hooks/useDebounce";
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
        <div className="bg-body overflow-auto" style={{ height: 'calc(100vh - 400px)', minHeight: '400px' }} onScroll={handleScroll}>
            <Table responsive size="sm" className="font-monospace small mb-0 table-fixed border-0">
                <thead className="sticky-top bg-body">
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
                <div className="p-3 text-center text-muted small border-top border-light-subtle bg-body-tertiary">
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
        test_split: { default: 0.2, min: 0, max: 0.5, step: 0.05 },
        validation_split: { default: 0.1, min: 0, max: 0.5, step: 0.05 },
        epochs: { default: 200, min: 1, max: 1000, step: 1 },
        batch_size: { default: 32, min: 4, max: 128, step: 4 },
        max_tokens: { default: 10000, min: 1000, max: 50000, step: 1000 },
        sequence_length: { default: 96, min: 16, max: 512, step: 8 },
        embedding_dims: { default: 64, min: 16, max: 512, step: 8 },
        dropout: { default: 0.2, min: 0, max: 1, step: 0.05 },
        learning_rate: { default: 0.001, min: 0.000001, max: 0.01, step: 0.000001 },
        weight_decay_rate: { default: 0, min: 0, max: 0.1, step: 0.001 },
        num_warmup_steps: { default: 0, min: 0, max: 5000, step: 10 },
        early_stopping: { default: true },
        monitor: { default: 'val_loss' },
        patience: { default: 10, min: 1, max: 50, step: 1 },
        pruning: { default: false },
        initial_sparsity: { default: 0, min: 0, max: 0.9, step: 0.05 },
        final_sparsity: { default: 0.5, min: 0.1, max: 0.95, step: 0.05 },
        pruning_begin_step: { default: 0, min: 0, max: 10000, step: 100 },
        pruning_end_step: { default: 1000, min: 100, max: 50000, step: 100 },
        pruning_frequency: { default: 100, min: 1, max: 1000, step: 1 },
        save_format: { default: 'tf' }
    },
    recurrent_neural_network: {
        architecture: { default: 'recurrent_neural_network' },
        test_split: { default: 0.2, min: 0, max: 0.5, step: 0.05 },
        validation_split: { default: 0.1, min: 0, max: 0.5, step: 0.05 },
        epochs: { default: 100, min: 1, max: 1000, step: 1 },
        batch_size: { default: 32, min: 4, max: 128, step: 4 },
        max_tokens: { default: 10000, min: 1000, max: 50000, step: 1000 },
        sequence_length: { default: 128, min: 16, max: 512, step: 8 },
        embedding_dims: { default: 64, min: 16, max: 512, step: 8 },
        lstm_dims: { default: 96, min: 16, max: 512, step: 8 },
        dropout: { default: 0.2, min: 0, max: 1, step: 0.05 },
        learning_rate: { default: 0.001, min: 0.000001, max: 0.01, step: 0.000001 },
        weight_decay_rate: { default: 0, min: 0, max: 0.1, step: 0.001 },
        num_warmup_steps: { default: 0, min: 0, max: 5000, step: 10 },
        early_stopping: { default: true },
        monitor: { default: 'val_loss' },
        patience: { default: 10, min: 1, max: 50, step: 1 },
        save_format: { default: 'tf' }
    },
    transformer: {
        architecture: { default: 'transformer' },
        pretrained_model: { default: PRETRAINED_MODELS[0] },
        test_split: { default: 0.2, min: 0, max: 0.5, step: 0.05 },
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
        pruning: { default: false },
        initial_sparsity: { default: 0, min: 0, max: 0.9, step: 0.05 },
        final_sparsity: { default: 0.5, min: 0.1, max: 0.95, step: 0.05 },
        pruning_begin_step: { default: 0, min: 0, max: 10000, step: 100 },
        pruning_end_step: { default: 1000, min: 100, max: 50000, step: 100 },
        pruning_frequency: { default: 100, min: 1, max: 1000, step: 1 },
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

const getTrainingStartParameters = (modelType = 'text_classification', training = null) => {
    const previousParameters = training?.kwargs || {};
    const availableArchitectures = ARCHITECTURES_BY_MODEL[modelType] || ARCHITECTURES_BY_MODEL.text_classification;
    const architecture = availableArchitectures.includes(previousParameters.architecture)
        ? previousParameters.architecture
        : availableArchitectures[0];
    const defaults = {};
    Object.entries(ARCHITECTURE_DEFAULTS[architecture]).forEach(([key, metadata]) => {
        defaults[key] = metadata.default;
    });
    return {
        ...defaults,
        ...previousParameters,
        architecture
    };
};

// Plain-language descriptions shown under each training setting.
const PARAMETER_DOCS = {
    test_split: 'Fraction of the dataset held out to evaluate the trained model.',
    validation_split: 'Fraction of the training data used to validate the model after each epoch.',
    architecture: 'Network architecture the model is built with. Changing it resets the settings below to the architecture defaults.',
    pretrained_model: 'Pretrained encoder the transformer is initialised from.',
    trainable: 'Fine-tune the pretrained encoder weights during training. Slower per epoch, but usually more accurate.',
    max_seq_len: 'Maximum number of tokens per example. Longer inputs are truncated.',
    sequence_length: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.',
    max_tokens: 'Maximum vocabulary size of the tokenizer. Less frequent tokens are dropped.',
    embedding_dims: 'Size of the learned word embedding vectors.',
    lstm_dims: 'Number of units in the LSTM layer.',
    units: 'Number of units in the dense layer on top of the encoder.',
    dropout: 'Fraction of units randomly dropped during training to reduce overfitting.',
    epochs: 'Maximum number of passes over the training data.',
    batch_size: 'Number of examples processed per optimisation step.',
    learning_rate: 'Step size the optimiser uses to update the weights.',
    early_stopping: 'Stop training early once the monitored metric stops improving, keeping the best weights.',
    monitor: 'Metric watched by early stopping.',
    patience: 'Epochs without improvement before training is stopped.',
    pruning: 'Gradually zero out low-magnitude weights during training to produce a smaller, faster model.',
    initial_sparsity: 'Fraction of weights zeroed when pruning begins.',
    final_sparsity: 'Fraction of weights zeroed by the end of pruning.',
    pruning_begin_step: 'Training step at which pruning starts.',
    pruning_end_step: 'Training step at which pruning stops.',
    pruning_frequency: 'Number of steps between sparsity updates.',
    weight_decay_rate: 'L2 penalty applied by the optimiser to keep weights small. Zero disables it.',
    num_warmup_steps: 'Steps over which the learning rate ramps up from zero before decaying.',
    save_format: 'Format the trained model is exported in for download and serving.'
};

const ARCHITECTURE_LABELS = {
    deep_neural_network: 'Deep neural network',
    recurrent_neural_network: 'Recurrent neural network (LSTM)',
    transformer: 'Transformer'
};

// Display names used in the start confirmation summary.
const PARAMETER_LABELS = {
    architecture: 'Architecture',
    pretrained_model: 'Pretrained model',
    test_split: 'Test split',
    validation_split: 'Validation split',
    epochs: 'Epochs',
    batch_size: 'Batch size',
    max_tokens: 'Max tokens',
    sequence_length: 'Sequence length',
    max_seq_len: 'Sequence length',
    embedding_dims: 'Embedding dimensions',
    lstm_dims: 'LSTM dimensions',
    units: 'Dense units',
    trainable: 'Trainable encoder',
    dropout: 'Dropout rate',
    l2: 'L2 regularisation',
    learning_rate: 'Learning rate',
    weight_decay_rate: 'Weight decay',
    num_warmup_steps: 'Warmup steps',
    early_stopping: 'Early stopping',
    monitor: 'Monitor',
    patience: 'Patience',
    pruning: 'Weight pruning',
    initial_sparsity: 'Initial sparsity',
    final_sparsity: 'Final sparsity',
    pruning_begin_step: 'Pruning begin step',
    pruning_end_step: 'Pruning end step',
    pruning_frequency: 'Pruning frequency',
    save_format: 'Save format'
};

const SAVE_FORMAT_OPTIONS = [
    ['tf', 'TensorFlow checkpoint (tf)'],
    ['saved_model', 'TensorFlow SavedModel (saved_model)'],
    ['h5', 'Keras HDF5 (h5)'],
    ['weights', 'Weights only (weights)'],
    ['tflite', 'TensorFlow Lite (tflite)'],
    ['onnx', 'ONNX (onnx)']
];

// Tab that owns each editable numeric field, used to jump to the first
// invalid input when CONTINUE is clicked from another tab.
const PARAMETER_TABS = {
    test_split: 'data',
    validation_split: 'data',
    sequence_length: 'model',
    max_seq_len: 'model',
    max_tokens: 'model',
    embedding_dims: 'model',
    lstm_dims: 'model',
    units: 'model',
    epochs: 'schedule',
    batch_size: 'schedule',
    learning_rate: 'schedule',
    patience: 'callbacks',
    pruning_begin_step: 'callbacks',
    pruning_end_step: 'callbacks',
    pruning_frequency: 'callbacks',
    weight_decay_rate: 'callbacks',
    num_warmup_steps: 'callbacks'
};

// A labelled training setting with its description, mirroring the deploy
// configuration form in Publish.
const TrainingField = ({ id, label, help, children }) => (
    <Form.Group className="mb-3" controlId={id}>
        <Form.Label className="small fw-bold mb-1">{label}</Form.Label>
        {children}
        <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{help}</Form.Text>
    </Form.Group>
);

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
                    <thead className="bg-body-tertiary sticky-top" style={{ zIndex: 1 }}>
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
                        <tfoot className="fw-bold bg-body-tertiary">
                            <tr>
                                <td className="border-end border-light-subtle">accuracy</td>
                                <td colSpan={3} className="border-end border-light-subtle"></td>
                                <td>{formatMetric(accuracy)}</td>
                            </tr>
                        </tfoot>
                    )}
                </Table>
            ) : (
                <pre className="small bg-body-tertiary p-3 rounded border border-light-subtle">{formatReport(report)}</pre>
            )}
        </div>
    );
};

const EmptyState = ({ children }) => (
    <div
        className="d-flex align-items-center justify-content-center text-muted"
        style={{
            minHeight: '200px',
            border: '1px solid var(--bs-border-color)',
            borderRadius: '4px',
            background: 'var(--bs-body-bg)'
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
                                <div className="text-body-emphasis small fw-medium">{item.value || '-'}</div>
                            </div>
                            {item.action}
                        </Card.Body>
                    </Card>
                </Col>
            ))}
        </Row>
    );
};

// Aggregate overview across all training versions, mirroring the per-version
// MetricStrip but summarising the whole list above the versions table.
const HistoryMetricStrip = ({ total, inProgress, succeeded, bestAccuracy, latestVersion }) => {
    // Only surface metrics that are relevant to the current list; empty or
    // not-yet-applicable values are dropped rather than shown as placeholders.
    const items = [
        { label: 'Total versions', value: total, icon: <Collection /> },
        latestVersion !== null && {
            label: 'Latest version',
            value: <span className="font-monospace">v{latestVersion}</span>,
            icon: <Hash />
        },
        inProgress > 0 && { label: 'In progress', value: inProgress, icon: <Activity /> },
        succeeded > 0 && { label: 'Succeeded', value: succeeded, icon: <Check2Circle /> },
        bestAccuracy !== null && {
            label: 'Best accuracy',
            value: <span className="fw-bold">{(bestAccuracy * 100).toFixed(2)}%</span>,
            icon: <GraphUp />
        }
    ].filter(Boolean);

    if (!total || items.length === 0) return null;

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
                                <div className="text-body-emphasis small fw-medium">{item.value ?? '-'}</div>
                            </div>
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
                <div className="flex-grow-1 overflow-auto rounded border border-light-subtle bg-body" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                    <Table hover size="sm" className="mb-0 text-center align-middle font-monospace small">
                        <thead className="sticky-top bg-body shadow-sm" style={{ zIndex: 10 }}>
                            <tr className="border-bottom border-light-subtle">
                                <th className="border-end border-light-subtle bg-body-tertiary text-center p-0"
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
                                    <th key={i} className="px-2 py-2 border-end border-light-subtle bg-body fw-bold text-muted text-truncate bg-body-tertiary" title={label} style={{ minWidth: '80px' }}>
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
                                    <td className="border-end border-light-subtle fw-bold text-muted text-end px-2 py-2 text-truncate bg-body-tertiary"
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
                                        const bgColor = intensity === 0 ? 'var(--bs-body-bg)' : `rgba(13, 110, 253, ${0.1 + intensity * 0.9})`;
                                        const textColor = intensity > 0.5 ? '#fff' : 'var(--bs-body-color)';
                                        const isDiagonal = rowIndex === colIndex;
                                        return (
                                            <td
                                                key={colIndex}
                                                style={{
                                                    backgroundColor: bgColor,
                                                    color: textColor,
                                                    fontWeight: value > 0 ? 'bold' : 'normal',
                                                    transition: 'all 0.15s ease',
                                                    outline: isDiagonal && value > 0 ? '1px solid var(--bs-border-color-translucent)' : undefined,
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
    const [showPoints, setShowPoints] = useState(false);
    const chartWrapRef = useRef(null);

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

    const downloadCsv = () => {
        const cols = ['epoch', ...selectedMetrics];
        const rows = data.map(row => cols.map(col => row[col] ?? '').join(','));
        downloadBlob(new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }), 'metrics.csv');
    };

    const downloadPng = () => {
        chartPng(chartWrapRef.current?.querySelector('svg.recharts-surface'), 'metrics.png');
    };

    if (metrics.length === 0) return <EmptyState>No history data available.</EmptyState>;

    return (
        <Row className="mt-2 gx-3" style={{ height: 'calc(100vh - 350px)' }}>
            <Col className="h-100">
                <Card className="border-light h-100">
                    <div className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 bg-body-tertiary border-bottom border-light-subtle">
                        <div className="d-flex flex-wrap align-items-center column-gap-2 row-gap-2">
                            <Form.Check
                                type="checkbox"
                                id="select-all-metrics"
                                label={<span className="small fw-bold text-muted">All</span>}
                                checked={isAllSelected}
                                onChange={(e) => handleAllToggle(e.target.checked)}
                                className="mb-0"
                            />

                            {metrics.map((metric, index) => (
                                <Form.Check
                                    key={metric}
                                    type="checkbox"
                                    id={`metric-${metric}`}
                                    label={
                                        <span className="d-inline-flex align-items-center gap-1 small" title={metric}>
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
                                            {metric}
                                        </span>
                                    }
                                    className="mb-0"
                                    checked={selectedMetrics.includes(metric)}
                                    onChange={() => {
                                        if (selectedMetrics.includes(metric)) {
                                            if (selectedMetrics.length > 1) {
                                                setSelectedMetrics(selectedMetrics.filter(m => m !== metric));
                                            }
                                        } else {
                                            setSelectedMetrics([...selectedMetrics, metric]);
                                        }
                                    }}
                                />
                            ))}
                        </div>

                        <div className="d-flex align-items-center gap-2 ms-xl-auto">
                            <span className="small fw-bold text-muted">Smoothing</span>
                            <Form.Range
                                min={1}
                                max={20}
                                step={1}
                                value={smoothing}
                                onChange={(e) => setSmoothing(parseInt(e.target.value))}
                                style={{ width: '80px' }}
                            />
                            <span className="small text-muted font-monospace" style={{ minWidth: '2ch' }}>{smoothing}</span>
                        </div>
                        <Form.Check
                            type="switch"
                            id="show-points"
                            label={<span className="small text-muted fw-bold">Points</span>}
                            checked={showPoints}
                            onChange={(e) => setShowPoints(e.target.checked)}
                            className="mb-0"
                        />
                        <Form.Check
                            type="switch"
                            id="log-scale-y"
                            label={<span className="small text-muted fw-bold">Log Y</span>}
                            checked={logScale}
                            onChange={(e) => setLogScale(e.target.checked)}
                            className="mb-0"
                        />
                        <div className="d-flex align-items-center gap-2">
                            <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Reset zoom" onClick={zoomOut}>
                                <ArrowCounterclockwise />
                            </Button>
                            <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Download CSV" onClick={downloadCsv}>
                                <FiletypeCsv />
                            </Button>
                            <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Download PNG" onClick={downloadPng}>
                                <FiletypePng />
                            </Button>
                        </div>
                    </div>
                    <Card.Body className="p-3 d-flex flex-column">
                        <div className="flex-grow-1" onDoubleClick={zoomOut} ref={chartWrapRef}>
                            <ResponsiveContainer>
                                <LineChart
                                    data={data}
                                    margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                                    onMouseDown={(e) => e && setRefAreaLeft(e.activeLabel)}
                                    onMouseMove={(e) => e && refAreaLeft && setRefAreaRight(e.activeLabel)}
                                    onMouseUp={zoom}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
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
                                        contentStyle={{ fontSize: '11px', border: '1px solid var(--bs-border-color)', borderRadius: '4px', backgroundColor: 'var(--bs-body-bg)', color: 'var(--bs-body-color)' }}
                                        itemStyle={{ padding: '1px 0' }}
                                    />
                                    {selectedMetrics.map((metric, index) => (
                                        <Line
                                            key={metric}
                                            type="monotone"
                                            dataKey={metric}
                                            stroke={chartColors[metrics.indexOf(metric) % chartColors.length]}
                                            dot={showPoints ? { r: 2, strokeWidth: 0, fill: chartColors[metrics.indexOf(metric) % chartColors.length] } : false}
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
        <pre className="p-3 mb-0 bg-body-tertiary border-0 rounded small overflow-auto" style={{ height: 'calc(100vh - 400px)', whiteSpace: 'pre-wrap' }}>
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
        <Card className="border-0 mt-4 overflow-hidden">
            <Card.Body className="p-0">
                <Tabs defaultActiveKey={defaultTab} variant="pills" className="custom-tabs gap-2 mb-2">
                    <Tab
                        eventKey="changes"
                        title={<TabTitle icon={<PlusSlashMinus />}>Data</TabTitle>}
                    >
                        <div className="pt-3">
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
                        eventKey="summary"
                        title={<TabTitle icon={<Stack />}>Layers</TabTitle>}
                        disabled={!hasSummary && training.status !== 'SUCCESS'}
                    >
                        <div className="pt-3">
                            <TrainingSummary training={training} />
                        </div>
                    </Tab>
                    <Tab
                        eventKey="parameters"
                        title={<TabTitle icon={<Sliders2 />}>Parameters</TabTitle>}
                    >
                        <div className="pt-3">
                            <TrainingParameters training={training} />
                        </div>
                    </Tab>
                    <Tab
                        eventKey="plots"
                        title={<TabTitle icon={<BarChartFill />}>Plots</TabTitle>}
                        disabled={!hasHistory && training.status !== 'SUCCESS'}
                    >
                        <div className="pt-3">
                            <TrainingPlots training={training} />
                        </div>
                    </Tab>
                    <Tab
                        eventKey="reports"
                        title={<TabTitle icon={<ListColumnsReverse />}>Reports</TabTitle>}
                        disabled={training.status !== 'SUCCESS'}
                    >
                        <div className="pt-3">
                            <ReportsPanel training={training} />
                        </div>
                    </Tab>
                    <Tab
                        eventKey="matrix"
                        title={<TabTitle icon={<Grid3x3GapFill />}>Matrix</TabTitle>}
                        disabled={training.status !== 'SUCCESS'}
                    >
                        <div className="pt-3">
                            <ConfusionMatrixPanel training={training} />
                        </div>
                    </Tab>
                    <Tab
                        eventKey="traceback"
                        title={<TabTitle icon={<BugFill />}>Error</TabTitle>}
                        disabled={training.status !== 'FAILURE'}
                    >
                        <div className="pt-3">
                            <pre className="p-3 mb-0 bg-danger bg-opacity-10 text-danger border-0 rounded small overflow-auto" style={{ height: 'calc(100vh - 400px)' }}>
                                {training.traceback || 'No traceback available.'}
                            </pre>
                        </div>
                    </Tab>
                </Tabs>
            </Card.Body>
        </Card>
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
    const [showStopConfirmation, setShowStopConfirmation] = useState(false);
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
            setShowStopConfirmation(false);
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
        if (!user || !socket || !TRAINING_ACTIVE_STATUSES.includes(trainingStatusRef.current)) return;
        const taskId = trainingTaskId;
        if (!taskId) return;

        const handleStatus = (data) => {
            if (data.task_id !== taskId) return;

            setTraining(prev => ({ ...prev, ...data }));
            if (TRAINING_DONE_STATUSES.includes(data.status)) {
                socket.emit('leave', user.token, data.task_id);
                roomRef.current = null;
            }
        };

        // Join on every (re)connect: the socket may still be handshaking when
        // this effect runs, and server-side room membership is lost whenever
        // the connection drops.
        const joinRoom = () => {
            socket.emit('join', user.token, taskId);
            roomRef.current = taskId;
        };

        socket.on('status', handleStatus);
        socket.on('connect', joinRoom);
        if (socket.connected) joinRoom();

        return () => {
            socket.off('status', handleStatus);
            socket.off('connect', joinRoom);
            if (roomRef.current === taskId) {
                if (socket.connected) socket.emit('leave', user.token, taskId);
                roomRef.current = null;
            }
        };
    }, [user, socket, trainingTaskId]);

    return (
        <div className="pb-5">
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
                        onStopTraining={() => setShowStopConfirmation(true)}
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
                    <Modal centered show={showStopConfirmation} onHide={() => setShowStopConfirmation(false)}>
                        <Modal.Header closeButton>
                            <Modal.Title className="small fw-bold text-muted">Stop training</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                            <p className="small">Stop this training run? Progress from the active run will be interrupted.</p>
                            <div className="d-flex justify-content-end gap-2">
                                <Button variant="light" size="sm" className="border small" onClick={() => setShowStopConfirmation(false)} disabled={stoppingTraining}>CANCEL</Button>
                                <Button variant="danger" size="sm" className="small" onClick={handleStopTraining} disabled={stoppingTraining}>
                                    {stoppingTraining ? <><Spinner animation="border" size="sm" />&nbsp;STOPPING...</> : 'STOP'}
                                </Button>
                            </div>
                        </Modal.Body>
                    </Modal>
                    <Modal centered show={showRestartConfirmation} onHide={handleCloseRestartConfirmation}>
                        <Modal.Header closeButton>
                            <Modal.Title className="small fw-bold text-muted">Retry training</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                            <p className="small">
                                Retrying this training will erase the current training results and replace them with the new run.
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
                                        <><Spinner animation="border" size="sm" />&nbsp;RETRYING...</>
                                    ) : (
                                        'RETRY'
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
    const [trainingTab, setTrainingTab] = useState('data');
    const [parameterErrors, setParameterErrors] = useState({});
    const [showStartConfirmation, setShowStartConfirmation] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [trainingsToDelete, setTrainingsToDelete] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [startingTraining, setStartingTraining] = useState(false);
    const [stoppingTrainingIds, setStoppingTrainingIds] = useState(new Set());
    const [restartingTrainingIds, setRestartingTrainingIds] = useState(new Set());
    const [trainingAction, setTrainingAction] = useState(null);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const pageRef = useRef(page);
    const [total, setTotal] = useState(0);
    const perPage = 7;
    const maxVisiblePages = 5;

    const debouncedQuery = useDebounce(query, 500);

    const selectedTrainings = trainings.filter((training) => selectedIds.has(training.id));
    const historySummary = useMemo(() => {
        const succeededTrainings = trainings.filter((training) => training.status === 'SUCCESS');
        const accuracies = succeededTrainings
            .map(getTrainingAccuracy)
            .filter((accuracy) => accuracy !== null);
        const versions = trainings
            .map((training) => Number(training.version))
            .filter((version) => Number.isFinite(version));
        return {
            succeeded: succeededTrainings.length,
            bestAccuracy: accuracies.length ? Math.max(...accuracies) : null,
            latestVersion: versions.length ? Math.max(...versions) : null
        };
    }, [trainings]);
    const canStopSelected = selectedTrainings.length > 0 && selectedTrainings.every(isTrainingActive);
    const canRetrySelected = selectedTrainings.length > 0 && selectedTrainings.every(isTrainingReady);
    const canDeleteSelected = selectedTrainings.length > 0 && selectedTrainings.every(isTrainingDeletable);

    const toggleRowSelection = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAllSelection = (visibleTrainings) => {
        setSelectedIds((prev) => {
            const allSelected = visibleTrainings.length > 0 && visibleTrainings.every((training) => prev.has(training.id));
            return allSelected ? new Set() : new Set(visibleTrainings.map((training) => training.id));
        });
    };

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
        // Don't reset while the form is open or awaiting confirmation.
        if (!showParameters && !showStartConfirmation) {
            setParameters(getTrainingStartParameters(model?.type, currentTraining));
        }
    }, [model?.type, currentTraining?.id, showParameters, showStartConfirmation]);

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
        setParameterErrors({});
    };

    const validateParameter = (field, value, params = paramters) => {
        const metadata = ARCHITECTURE_DEFAULTS[params.architecture]?.[field] || {};
        if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
            return 'Enter a value.';
        }
        if (metadata.min !== undefined && value < metadata.min) return `Must be at least ${metadata.min}.`;
        if (metadata.max !== undefined && value > metadata.max) return `Must be at most ${metadata.max}.`;
        if (field === 'pruning_end_step' && typeof params.pruning_begin_step === 'number' && value <= params.pruning_begin_step) {
            return 'Must be greater than the pruning begin step.';
        }
        return null;
    };

    // Numeric fields currently editable in the form; fields hidden by the
    // architecture or a disabled switch keep their defaults and are skipped.
    const getEditableNumberFields = () => {
        const fields = [];
        if (paramters.architecture === 'transformer') {
            fields.push('max_seq_len');
            if (model?.type !== 'named_entity_recognition') fields.push('units');
        } else {
            fields.push('sequence_length', 'max_tokens', 'embedding_dims');
            if (paramters.architecture === 'recurrent_neural_network') fields.push('lstm_dims');
        }
        fields.push('epochs', 'batch_size', 'learning_rate');
        if (paramters.early_stopping) fields.push('patience');
        if (model?.type === 'text_classification' && paramters.pruning) {
            fields.push('pruning_begin_step', 'pruning_end_step', 'pruning_frequency');
        }
        fields.push('weight_decay_rate', 'num_warmup_steps');
        return fields;
    };

    const updateParameter = (field, value) => {
        setParameters(prev => ({ ...prev, [field]: value }));
        setParameterErrors(prev => {
            const message = validateParameter(field, value, { ...paramters, [field]: value });
            const next = { ...prev };
            if (message) next[field] = message;
            else delete next[field];
            return next;
        });
    };

    const handleOpenStartTraining = () => {
        setParameters(getTrainingStartParameters(model?.type, currentTraining));
        setParameterErrors({});
        setTrainingTab('data');
        setShowStartConfirmation(false);
        setShowParameters(true);
    };

    const handleCloseStartTraining = () => {
        if (startingTraining) return;
        setShowParameters(false);
        setShowStartConfirmation(false);
    };

    // CONTINUE validates the settings and swaps the modal body for the start
    // confirmation, keeping the edits. Invalid fields keep the form open and
    // switch to the tab holding the first offending input.
    const handleContinueTraining = (event) => {
        event.preventDefault();
        const fields = getEditableNumberFields();
        const errors = {};
        fields.forEach(field => {
            const message = validateParameter(field, paramters[field]);
            if (message) errors[field] = message;
        });
        setParameterErrors(errors);
        const firstInvalid = fields.find(field => errors[field]);
        if (firstInvalid) {
            setTrainingTab(PARAMETER_TABS[firstInvalid] || 'data');
            return;
        }
        setShowStartConfirmation(true);
    };

    // Going back (or dismissing the confirmation) returns to the form.
    const handleBackToParameters = () => {
        if (startingTraining) return;
        setShowStartConfirmation(false);
    };

    // Precise values are typed; bounded fractions use a slider instead.
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
            <TrainingField id={`training-${field}`} label={label} help={PARAMETER_DOCS[field]}>
                <Form.Control
                    disabled={disabled}
                    type="number"
                    size="sm"
                    min={min}
                    max={max}
                    step={step}
                    value={paramters[field]}
                    isInvalid={Boolean(parameterErrors[field])}
                    onChange={(e) => updateParameter(field, e.target.value === '' ? '' : parse(e.target.value))}
                />
                <Form.Control.Feedback type="invalid">{parameterErrors[field]}</Form.Control.Feedback>
            </TrainingField>
        );
    };

    const renderSliderControl = (field, label, options = {}) => {
        const metadata = ARCHITECTURE_DEFAULTS[paramters.architecture]?.[field] || {};
        const { disabled = false } = options;

        return (
            <Form.Group className="mb-3" controlId={`training-${field}`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Label className="small fw-bold mb-0">{label}</Form.Label>
                    <span className="small text-muted font-monospace">{paramters[field]}</span>
                </div>
                <Form.Range
                    disabled={disabled}
                    min={metadata.min}
                    max={metadata.max}
                    step={metadata.step}
                    value={paramters[field]}
                    onChange={(e) => updateParameter(field, parseFloat(e.target.value))}
                />
                <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>
                    {PARAMETER_DOCS[field]}
                </Form.Text>
            </Form.Group>
        );
    };

    const renderSwitchControl = (field, label) => (
        <>
            <Form.Check
                type="switch"
                id={`training-${field}`}
                className="small"
                label={label}
                checked={Boolean(paramters[field])}
                onChange={(e) => updateParameter(field, e.target.checked)}
            />
            <Form.Text className="text-muted d-block mb-3" style={{ fontSize: '0.7rem' }}>
                {PARAMETER_DOCS[field]}
            </Form.Text>
        </>
    );

    const handleTrain = async () => {
        try {
            setStartingTraining(true);
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
                }
                setTotal(prev => prev + 1);
            } else {
                setPage(1);
            }
            setShowStartConfirmation(false);
            setShowParameters(false);
        } catch (error) {
            setAlert({ variant: 'danger', message: error.response?.data?.error || error.message });
        } finally {
            setStartingTraining(false);
        }
    };

    // Every parameter sent to the server, recapped in the start confirmation.
    const formatSummaryValue = (field, value) => {
        if (field === 'architecture') return ARCHITECTURE_LABELS[value] || value;
        if (typeof value === 'boolean') return value ? 'on' : 'off';
        return String(value);
    };

    const trainingSummary = Object.entries(paramters).map(([field, value]) => [
        field,
        PARAMETER_LABELS[field] || field.replace(/_/g, ' '),
        formatSummaryValue(field, value)
    ]);

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

    const handleOpenDeleteConfirmation = (trainingsForDeletion) => {
        setTrainingsToDelete(trainingsForDeletion);
        setShowDeleteConfirmation(true);
    };

    const handleCloseDeleteConfirmation = () => {
        setTrainingsToDelete([]);
        setShowDeleteConfirmation(false);
    }

    const handleDelete = async (trainingIds) => {
        try {
            setSubmitting(true);
            setLoading(true);
            const headers = { "Authorization": `Bearer ${user.token}` }
            await Promise.all(trainingIds.map((trainingId) => axios.delete(`/api/models/${model.id}/trainings/${trainingId}`, { headers })));
            setActiveTrainings(prev => prev.filter(training => !trainingIds.includes(training.id)));
            const remainingOnPage = trainings.length - trainingIds.length;
            if (remainingOnPage > 0) {
                if (page === Math.ceil((total) / perPage)) {
                    if (page === 1 && trainingIds.includes(currentTraining?.id))
                        setCurrentTraining(trainings.find((t) => !trainingIds.includes(t.id)) || null)
                    setTrainings(prev => prev.filter((t) => !trainingIds.includes(t.id)));
                    setTotal(total - trainingIds.length);
                } else {
                    let params = { extended: '1', page: page, per_page: perPage };
                    if (debouncedQuery !== '')
                        params.query = debouncedQuery;
                    const response = await axios.get(`/api/models/${model.id}/trainings`, { params, headers });
                    setTrainings(response.data.trainings);
                    setTotal(response.data.total);
                    if (trainingIds.includes(currentTraining?.id))
                        setCurrentTraining(response.data.trainings[0]);
                }
            } else {
                if (page > 1) {
                    setPage(page - 1);
                } else {
                    if (trainingIds.includes(currentTraining?.id))
                        setCurrentTraining(null);
                    setTrainings([]);
                    setTotal(0);
                }
            }
            setSelectedIds(prev => {
                const next = new Set(prev);
                trainingIds.forEach((id) => next.delete(id));
                return next;
            });
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
        setSelectedIds(new Set());
    }, [page, debouncedQuery]);

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
        if (!user || !socket || activeTrainingTaskIds.length === 0) return;
        const activeRooms = rooms.current;

        const handleStatus = (data) => {
            if (!activeRooms.has(data.task_id)) return;

            updateTraining(data);
            if (TRAINING_DONE_STATUSES.includes(data.status)) {
                socket.emit('leave', user.token, data.task_id);
                rooms.current.delete(data.task_id);
            }
        };

        // Join on every (re)connect: the socket may still be handshaking when
        // this effect runs, and server-side room membership is lost whenever
        // the connection drops.
        const joinRooms = () => {
            activeTrainingTaskIds.forEach(taskId => {
                socket.emit('join', user.token, taskId);
                activeRooms.add(taskId);
            });
        };

        socket.on('status', handleStatus);
        socket.on('connect', joinRooms);
        if (socket.connected) joinRooms();

        return () => {
            socket.off('status', handleStatus);
            socket.off('connect', joinRooms);
            activeTrainingTaskIds.forEach(taskId => {
                if (socket.connected) socket.emit('leave', user.token, taskId);
                activeRooms.delete(taskId);
            });
        };
    }, [user, socket, activeTrainingTaskKey]);

    return (
        <div>
            <Row className="mt-4">
                <Col>
                    {alert && <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>{alert.message}</Alert>}
                </Col>
            </Row>
            <HistoryMetricStrip
                total={total}
                inProgress={activeTrainings.length}
                succeeded={historySummary.succeeded}
                bestAccuracy={historySummary.bestAccuracy}
                latestVersion={historySummary.latestVersion}
            />
            <Row className="mt-4">
                <Col>
                    <ButtonToolbar>
                        <ButtonGroup className="me-2">
                            {hasActiveTraining ? (
                                <Button variant="light" disabled className="border">
                                    <Spinner
                                        animation={activeTrainingStatus === 'STARTED' ? 'grow' : 'border'}
                                        size="sm"
                                    />
                                    &nbsp;{activeTrainingStatus === 'STARTED' ? 'training...' : 'pending...'}
                                </Button>
                            ) : (
                                <Button
                                    variant="light"
                                    onClick={handleOpenStartTraining}
                                    className="border"
                                >
                                    <PlusLg />&nbsp;create training
                                </Button>
                            )}
                        </ButtonGroup>
                        <ButtonGroup>
                            <Button
                                variant="light"
                                className="border"
                                title="Stop selected"
                                aria-label="Stop selected"
                                disabled={!canStopSelected || selectedTrainings.some((t) => stoppingTrainingIds.has(t.id))}
                                onClick={() => setTrainingAction({ type: 'stop', trainings: selectedTrainings })}
                            >
                                <StopCircleFill />
                            </Button>
                            <Button
                                variant="light"
                                className="border"
                                title="Retry selected"
                                aria-label="Retry selected"
                                disabled={!canRetrySelected || selectedTrainings.some((t) => restartingTrainingIds.has(t.id))}
                                onClick={() => setTrainingAction({ type: 'retry', trainings: selectedTrainings })}
                            >
                                <ArrowClockwise />
                            </Button>
                            <Button
                                variant="light"
                                className="border text-danger"
                                title="Delete selected"
                                aria-label="Delete selected"
                                disabled={!canDeleteSelected}
                                onClick={() => handleOpenDeleteConfirmation(selectedTrainings)}
                            >
                                <Trash />
                            </Button>
                        </ButtonGroup>
                    </ButtonToolbar>
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
                    <Card className="border-light overflow-hidden">
                        <CardHeading
                            icon={<ClockHistory />}
                            title="Trainings"
                            right={
                                <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                                    {total} training{total === 1 ? '' : 's'}
                                </span>
                            }
                        />
                        <Card.Body className="p-0">
                            <Table
                                responsive
                                hover
                                className="mb-0 align-middle text-center"
                                style={{ minHeight: '33vh' }}
                            >
                                <thead>
                                    <tr>
                                        <th style={{ width: '40px' }}>
                                            <Form.Check
                                                type="checkbox"
                                                checked={trainings.length > 0 && trainings.every((training) => selectedIds.has(training.id))}
                                                onChange={() => toggleAllSelection(trainings)}
                                                disabled={loading || trainings.length === 0}
                                            />
                                        </th>
                                        <th><Hash className="text-muted" />&nbsp;Version</th>
                                        <th><Activity className="text-muted" />&nbsp;Status</th>
                                        <th><Clock className="text-muted" />&nbsp;Started</th>
                                        <th><Calendar3 className="text-muted" />&nbsp;Completed</th>
                                        <th><GraphUp className="text-muted" />&nbsp;Accuracy (%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr >
                                            <td
                                                colSpan={6}
                                                style={{
                                                    verticalAlign: 'middle'
                                                }}
                                            >
                                                <Spinner animation='border' size='lg' />
                                            </td>
                                        </tr>
                                    ) : total > 0 ?
                                        trainings.map((training) => (
                                            <tr key={training.id}>
                                                <td>
                                                    <Form.Check
                                                        type="checkbox"
                                                        checked={selectedIds.has(training.id)}
                                                        onChange={() => toggleRowSelection(training.id)}
                                                    />
                                                </td>
                                                <td>
                                                    <Link to={`/models/${modelId}/history/${training.id}`} className="text-decoration-none font-monospace">
                                                        {training.version}
                                                    </Link>
                                                </td>
                                                <td>{getTrainingStatusBadge(training.status)}</td>
                                                <td className="small text-muted">{training.created_at}</td>
                                                <td className="small text-muted">{training.date_done}</td>
                                                <td className="font-monospace">{training.status === 'SUCCESS' && getTrainingAccuracy(training) !== null && (getTrainingAccuracy(training) * 100).toFixed(2)}</td>
                                            </tr>
                                        )) : query !== '' ? (
                                            <tr>
                                                <td
                                                    colSpan={6}
                                                    style={{
                                                        verticalAlign: 'middle'
                                                    }}
                                                >
                                                    <EmptyMessage icon={<Search />}>
                                                        could not find the training you are looking for.
                                                    </EmptyMessage>
                                                </td>
                                            </tr>
                                        ) : (
                                            <tr>
                                                <td
                                                    colSpan={6}
                                                    style={{
                                                        verticalAlign: 'middle'
                                                    }}
                                                >
                                                    <EmptyMessage icon={<InfoCircle />}>
                                                        looks like you have no trainings.
                                                    </EmptyMessage>
                                                </td>
                                            </tr>
                                        )}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                    {total > perPage &&
                        <Pagination className="justify-content-start mt-3">
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
            <Modal size="lg" centered scrollable show={showParameters} onHide={handleCloseStartTraining}>
                <Modal.Header closeButton={!startingTraining}>
                    <Modal.Title className="small fw-bold text-muted d-inline-flex align-items-center gap-2">
                        <Sliders2 /> {showStartConfirmation ? 'Start training' : 'Training configuration'}
                    </Modal.Title>
                </Modal.Header>
                {showStartConfirmation ? (
                    <Modal.Body>
                        <p className="small">
                            Start a new training run with this configuration? A new version will be
                            created and queued right away.
                        </p>
                        <div className="border border-light-subtle rounded mb-3 overflow-auto" style={{ maxHeight: '50vh' }}>
                            <Row className="g-0">
                                {trainingSummary.map(([field, label, value], index) => (
                                    <Col sm={6} key={field}>
                                        <div
                                            className={`d-flex justify-content-between gap-3 px-3 py-2 small${index > 1 ? ' border-top border-light-subtle' : ''}${index % 2 === 1 ? ' border-start border-light-subtle' : ''}`}
                                        >
                                            <span className="text-muted fw-bold">{label}</span>
                                            <span className="font-monospace text-truncate" title={value}>{value}</span>
                                        </div>
                                    </Col>
                                ))}
                            </Row>
                        </div>
                        <div className="d-flex justify-content-end gap-2">
                            <Button variant="light" size="sm" className="border small" onClick={handleBackToParameters} disabled={startingTraining}>
                                BACK
                            </Button>
                            <Button variant="primary" size="sm" className="small" onClick={handleTrain} disabled={startingTraining}>
                                {startingTraining ? (
                                    <><Spinner animation="border" size="sm" />&nbsp;STARTING...</>
                                ) : (
                                    'START TRAINING'
                                )}
                            </Button>
                        </div>
                    </Modal.Body>
                ) : (
                <Form noValidate onSubmit={handleContinueTraining}>
                    <Modal.Body>
                        <div style={{ minHeight: '18rem' }}>
                            <Tabs
                                variant="pills"
                                activeKey={trainingTab}
                                onSelect={(key) => setTrainingTab(key)}
                                className="small mb-3"
                                justify
                            >
                                <Tab eventKey="data" title="Data">
                                    <Row>
                                        <Col sm={6}>{renderSliderControl('test_split', 'Test split')}</Col>
                                        <Col sm={6}>{renderSliderControl('validation_split', 'Validation split')}</Col>
                                    </Row>
                                </Tab>
                                <Tab eventKey="model" title="Model">
                                    <TrainingField id="training-architecture" label="Architecture" help={PARAMETER_DOCS.architecture}>
                                        <Form.Select
                                            size="sm"
                                            value={paramters.architecture}
                                            onChange={(e) => handleArchitectureChange(e.target.value)}
                                        >
                                            {architectureOptions.map((architecture) => (
                                                <option key={architecture} value={architecture}>
                                                    {ARCHITECTURE_LABELS[architecture] || architecture}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </TrainingField>
                                    {paramters.architecture === 'transformer' && (
                                        <>
                                            <TrainingField id="training-pretrained-model" label="Pretrained model" help={PARAMETER_DOCS.pretrained_model}>
                                                <Form.Select
                                                    size="sm"
                                                    value={paramters.pretrained_model}
                                                    onChange={(e) => updateParameter('pretrained_model', e.target.value)}
                                                >
                                                    {PRETRAINED_MODELS.map((pretrainedModel) => (
                                                        <option key={pretrainedModel} value={pretrainedModel}>{pretrainedModel}</option>
                                                    ))}
                                                </Form.Select>
                                            </TrainingField>
                                            {renderSwitchControl('trainable', 'Trainable encoder')}
                                        </>
                                    )}
                                    <Row>
                                        <Col sm={6}>
                                            {paramters.architecture === 'transformer'
                                                ? renderNumberControl('max_seq_len', 'Sequence length')
                                                : renderNumberControl('sequence_length', 'Sequence length')}
                                        </Col>
                                        {['deep_neural_network', 'recurrent_neural_network'].includes(paramters.architecture) && (
                                            <>
                                                <Col sm={6}>{renderNumberControl('max_tokens', 'Max tokens')}</Col>
                                                <Col sm={6}>{renderNumberControl('embedding_dims', 'Embedding dimensions')}</Col>
                                            </>
                                        )}
                                        {paramters.architecture === 'recurrent_neural_network' && (
                                            <Col sm={6}>{renderNumberControl('lstm_dims', 'LSTM dimensions')}</Col>
                                        )}
                                        {paramters.architecture === 'transformer' && model?.type !== 'named_entity_recognition' && (
                                            <Col sm={6}>{renderNumberControl('units', 'Dense units')}</Col>
                                        )}
                                        {(paramters.architecture !== 'transformer' || model?.type !== 'named_entity_recognition') && (
                                            <Col sm={6}>{renderSliderControl('dropout', 'Dropout rate')}</Col>
                                        )}
                                    </Row>
                                </Tab>
                                <Tab eventKey="schedule" title="Schedule">
                                    <Row>
                                        <Col sm={6}>{renderNumberControl('epochs', 'Epochs')}</Col>
                                        <Col sm={6}>{renderNumberControl('batch_size', 'Batch size')}</Col>
                                        <Col sm={6}>{renderNumberControl('learning_rate', 'Learning rate')}</Col>
                                    </Row>
                                </Tab>
                                <Tab eventKey="callbacks" title="Callbacks">
                                    {renderSwitchControl('early_stopping', 'Early stopping')}
                                    {paramters.early_stopping && (
                                        <Row>
                                            <Col sm={6}>
                                                <TrainingField id="training-monitor" label="Monitor" help={PARAMETER_DOCS.monitor}>
                                                    <Form.Select
                                                        size="sm"
                                                        value={paramters.monitor}
                                                        onChange={(e) => updateParameter('monitor', e.target.value)}
                                                    >
                                                        {monitorOptions.map(([value, label]) => (
                                                            <option key={value} value={value}>{label}</option>
                                                        ))}
                                                    </Form.Select>
                                                </TrainingField>
                                            </Col>
                                            <Col sm={6}>{renderNumberControl('patience', 'Patience')}</Col>
                                        </Row>
                                    )}
                                    {model?.type === 'text_classification' && (
                                        <>
                                            {renderSwitchControl('pruning', 'Weight pruning')}
                                            {paramters.pruning && (
                                                <Row>
                                                    <Col sm={6}>{renderSliderControl('initial_sparsity', 'Initial sparsity')}</Col>
                                                    <Col sm={6}>{renderSliderControl('final_sparsity', 'Final sparsity')}</Col>
                                                    <Col sm={6}>{renderNumberControl('pruning_begin_step', 'Begin step')}</Col>
                                                    <Col sm={6}>{renderNumberControl('pruning_end_step', 'End step')}</Col>
                                                    <Col sm={6}>{renderNumberControl('pruning_frequency', 'Update frequency')}</Col>
                                                </Row>
                                            )}
                                        </>
                                    )}
                                    <Row>
                                        <Col sm={6}>{renderNumberControl('weight_decay_rate', 'Weight decay')}</Col>
                                        <Col sm={6}>{renderNumberControl('num_warmup_steps', 'Warmup steps')}</Col>
                                    </Row>
                                </Tab>
                                <Tab eventKey="export" title="Export">
                                    <TrainingField id="training-save-format" label="Save format" help={PARAMETER_DOCS.save_format}>
                                        <Form.Select
                                            size="sm"
                                            value={paramters.save_format}
                                            onChange={(e) => updateParameter('save_format', e.target.value)}
                                        >
                                            {SAVE_FORMAT_OPTIONS.map(([value, label]) => (
                                                <option key={value} value={value}>{label}</option>
                                            ))}
                                        </Form.Select>
                                    </TrainingField>
                                </Tab>
                            </Tabs>
                        </div>
                        <div className="d-flex justify-content-end gap-2">
                            <Button variant="light" size="sm" className="border small" onClick={handleCloseStartTraining}>CANCEL</Button>
                            <Button variant="primary" size="sm" className="small" type="submit">CONTINUE</Button>
                        </div>
                    </Modal.Body>
                </Form>
                )}
            </Modal>
            <Modal centered show={Boolean(trainingAction)} onHide={() => setTrainingAction(null)}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">
                        {trainingAction?.type === 'stop' ? 'Stop training' : 'Retry training'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="small">
                        {trainingAction?.type === 'stop'
                            ? `Stop ${trainingAction.trainings.length > 1 ? `these ${trainingAction.trainings.length} training runs` : 'this training run'}? Progress from the active run will be interrupted.`
                            : `Retry ${trainingAction?.trainings.length > 1 ? `these ${trainingAction.trainings.length} trainings` : 'this training'}? The existing results for ${trainingAction?.trainings.length > 1 ? 'these versions' : 'this version'} will be replaced.`}
                    </p>
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" className="border small" onClick={() => setTrainingAction(null)}>CANCEL</Button>
                        <Button
                            variant={trainingAction?.type === 'stop' ? 'danger' : 'warning'}
                            size="sm"
                            className="small"
                            onClick={async () => {
                                const action = trainingAction;
                                setTrainingAction(null);
                                if (action?.type === 'stop') await Promise.all(action.trainings.map((training) => handleStopTraining(training)));
                                if (action?.type === 'retry') await Promise.all(action.trainings.map((training) => handleRestartTraining(training)));
                            }}
                        >
                            {trainingAction?.type === 'stop' ? 'STOP' : 'RETRY'}
                        </Button>
                    </div>
                </Modal.Body>
            </Modal>
            <Modal centered show={showDeleteConfirmation} onHide={handleCloseDeleteConfirmation}>
                <Modal.Header closeButton>
                    <Modal.Title className="small fw-bold text-muted">Delete training</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {trainingsToDelete.length > 1 ? (
                        <>
                            <p className="small">Are you sure you want to delete these {trainingsToDelete.length} training records?</p>
                            <ul className="small text-muted">
                                {trainingsToDelete.map((training) => <li key={training.id}>{training.version}</li>)}
                            </ul>
                        </>
                    ) : (
                        <p className="small">Are you sure you want to delete this training record?</p>
                    )}
                    <div className="d-flex justify-content-end gap-2">
                        <Button variant="light" size="sm" onClick={handleCloseDeleteConfirmation} className="border small">CANCEL</Button>
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={submitting}
                            onClick={() => handleDelete(trainingsToDelete.map((training) => training.id))}
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
