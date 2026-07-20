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
    Percent,
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
    Collection,
    Stopwatch,
    Option
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
import { getReport, getTrainingAccuracy, getTrainingTrainAccuracy, getLatestHistoryMetric, getTrainingRuntime, formatDuration, getConfusionMatrix, reportRows } from "../../../../shared/utils/training";
import { Link, useParams } from "react-router-dom";
import useDebounce from "../../../../shared/hooks/useDebounce";
import useTableControls from "../../../../shared/hooks/useTableControls";
import SortHeader from "../../../../shared/components/SortHeader";
import { TableFilters, FilterChips } from "../../../../shared/components/TableFilters";
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
    text_classification: ['deep_neural_network', 'recurrent_neural_network', 'transformer'],
    named_entity_recognition: ['recurrent_neural_network', 'transformer'],
    natural_language_understanding: ['deep_neural_network', 'transformer']
};

const ARCHITECTURE_LABELS = {
    deep_neural_network: 'Deep neural network',
    recurrent_neural_network: 'Recurrent neural network (LSTM)',
    transformer: 'Transformer'
};

const ACTIVATION_OPTIONS = [['relu', 'ReLU'], ['tanh', 'Tanh'], ['gelu', 'GELU'], ['elu', 'ELU']];

const MONITOR_OPTIONS = [
    ['accuracy', 'accuracy'],
    ['loss', 'loss'],
    ['val_accuracy', 'validation accuracy'],
    ['val_loss', 'validation loss']
];

// NLU compiles per-head metrics (intents_accuracy / slots_accuracy), so plain
// accuracy is not a valid early-stopping monitor there.
const NLU_MONITOR_OPTIONS = [['loss', 'loss'], ['val_loss', 'validation loss']];

const SAVE_FORMAT_OPTIONS = [
    ['tf', 'TensorFlow checkpoint (tf)'],
    ['saved_model', 'TensorFlow SavedModel (saved_model)'],
    ['h5', 'Keras HDF5 (h5)'],
    ['weights', 'Weights only (weights)'],
    ['tflite', 'TensorFlow Lite (tflite)'],
    ['onnx', 'ONNX (onnx)']
];

const MAX_HIDDEN_LAYERS = 6;
const HIDDEN_LAYER_UNITS = { min: 16, max: 1024, step: 16 };

// Every form field is declared here and rendered generically:
// { control: 'slider' | 'select' | 'switch' | 'layers', tab, default,
//   min/max/step (sliders), scale: 'log' (sliders), options (selects),
//   label, help, showIf?(params) }
const COMMON_PARAMETERS = {
    test_split: { control: 'slider', tab: 'data', default: 0.2, min: 0.05, max: 0.5, step: 0.05, label: 'Test split', help: 'Fraction of the dataset held out to evaluate the trained model.' },
    validation_split: { control: 'slider', tab: 'data', default: 0.1, min: 0, max: 0.5, step: 0.05, label: 'Validation split', help: 'Fraction of the training data used to validate the model after each epoch.' },
    epochs: { control: 'slider', tab: 'schedule', default: 100, min: 1, max: 1000, step: 1, label: 'Epochs', help: 'Maximum number of passes over the training data.' },
    batch_size: { control: 'slider', tab: 'schedule', default: 32, min: 4, max: 128, step: 4, label: 'Batch size', help: 'Number of examples processed per optimisation step.' },
    learning_rate: { control: 'slider', tab: 'schedule', scale: 'log', default: 0.001, min: 0.000001, max: 0.01, label: 'Learning rate', help: 'Step size the optimiser uses to update the weights.' },
    weight_decay_rate: { control: 'slider', tab: 'schedule', default: 0, min: 0, max: 0.1, step: 0.001, label: 'Weight decay', help: 'L2 penalty applied by the optimiser to keep weights small. Zero disables it.' },
    num_warmup_steps: { control: 'slider', tab: 'schedule', default: 0, min: 0, max: 5000, step: 10, label: 'Warmup steps', help: 'Steps over which the learning rate ramps up from zero before decaying.' },
    early_stopping: { control: 'switch', tab: 'callbacks', default: true, label: 'Early stopping', help: 'Stop training early once the monitored metric stops improving, keeping the best weights.' },
    monitor: { control: 'select', tab: 'callbacks', default: 'val_loss', options: MONITOR_OPTIONS, label: 'Monitor', help: 'Metric watched by early stopping.', showIf: (params) => params.early_stopping },
    patience: { control: 'slider', tab: 'callbacks', default: 10, min: 1, max: 50, step: 1, label: 'Patience', help: 'Epochs without improvement before training is stopped.', showIf: (params) => params.early_stopping },
    save_format: { control: 'select', tab: 'export', default: 'tf', options: SAVE_FORMAT_OPTIONS, label: 'Save format', help: 'Format the trained model is exported in for download and serving.' }
};

const PRUNING_PARAMETERS = {
    pruning: { control: 'switch', tab: 'callbacks', default: false, label: 'Weight pruning', help: 'Gradually zero out low-magnitude weights of dense layers during training to produce a smaller, faster model.' },
    initial_sparsity: { control: 'slider', tab: 'callbacks', default: 0, min: 0, max: 0.9, step: 0.05, label: 'Initial sparsity', help: 'Fraction of weights zeroed when pruning begins.', showIf: (params) => params.pruning },
    final_sparsity: { control: 'slider', tab: 'callbacks', default: 0.5, min: 0.1, max: 0.95, step: 0.05, label: 'Final sparsity', help: 'Fraction of weights zeroed by the end of pruning.', showIf: (params) => params.pruning },
    pruning_begin_step: { control: 'slider', tab: 'callbacks', default: 0, min: 0, max: 10000, step: 100, label: 'Pruning begin step', help: 'Training step at which pruning starts.', showIf: (params) => params.pruning },
    pruning_end_step: { control: 'slider', tab: 'callbacks', default: 1000, min: 100, max: 50000, step: 100, label: 'Pruning end step', help: 'Training step at which pruning stops.', showIf: (params) => params.pruning },
    pruning_frequency: { control: 'slider', tab: 'callbacks', default: 100, min: 1, max: 1000, step: 1, label: 'Pruning frequency', help: 'Number of steps between sparsity updates.', showIf: (params) => params.pruning }
};

const hiddenLayersField = (defaultLayers) => ({
    control: 'layers',
    tab: 'model',
    default: defaultLayers,
    label: 'Hidden layers',
    help: 'Extra dense layers applied just before the output head — configure units and activation per layer.'
});

const ARCHITECTURE_PARAMETERS = {
    deep_neural_network: {
        max_tokens: { control: 'slider', tab: 'model', default: 10000, min: 1000, max: 50000, step: 1000, label: 'Max tokens', help: 'Maximum vocabulary size of the tokenizer. Less frequent tokens are dropped.' },
        sequence_length: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        embedding_dims: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Embedding dimensions', help: 'Size of the learned word embedding vectors.' },
        dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        hidden_layers: hiddenLayersField([])
    },
    recurrent_neural_network: {
        max_tokens: { control: 'slider', tab: 'model', default: 10000, min: 1000, max: 50000, step: 1000, label: 'Max tokens', help: 'Maximum vocabulary size of the tokenizer. Less frequent tokens are dropped.' },
        sequence_length: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        embedding_dims: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Embedding dimensions', help: 'Size of the learned word embedding vectors.' },
        dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        hidden_layers: hiddenLayersField([])
    },
    transformer: {
        pretrained_model: { control: 'select', tab: 'model', default: PRETRAINED_MODELS[0], options: PRETRAINED_MODELS.map((name) => [name, name]), label: 'Pretrained model', help: 'Pretrained encoder the transformer is initialised from.' },
        trainable: { control: 'switch', tab: 'model', default: false, label: 'Trainable encoder', help: 'Fine-tune the pretrained encoder weights during training. Slower per epoch, but usually more accurate.' },
        sequence_length: { control: 'slider', tab: 'model', default: 128, min: 16, max: 512, step: 16, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        dropout: { control: 'slider', tab: 'model', default: 0.15, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        l2: { control: 'slider', tab: 'model', default: 0.01, min: 0, max: 0.1, step: 0.001, label: 'L2 regularisation', help: 'L2 penalty on the output head weights.' },
        hidden_layers: hiddenLayersField([{ units: 768, activation: 'relu' }]),
        epochs: { ...COMMON_PARAMETERS.epochs, default: 5, max: 100 },
        batch_size: { ...COMMON_PARAMETERS.batch_size, default: 16 },
        learning_rate: { ...COMMON_PARAMETERS.learning_rate, default: 0.00002, max: 0.001 },
        weight_decay_rate: { ...COMMON_PARAMETERS.weight_decay_rate, default: 0.01 },
        patience: { ...COMMON_PARAMETERS.patience, default: 3 }
    }
};

// Per-model-type patches over the architecture metadata. A field listed here
// replaces the base entry wholesale; new fields append.
const TYPE_OVERRIDES = {
    text_classification: {
        deep_neural_network: {
            epochs: { ...COMMON_PARAMETERS.epochs, default: 200 },
            ...PRUNING_PARAMETERS
        },
        recurrent_neural_network: {
            recurrent_layer: { control: 'select', tab: 'model', default: 'lstm', options: [['lstm', 'LSTM'], ['gru', 'GRU']], label: 'Recurrent layer', help: 'Type of recurrent cell.' },
            bidirectional: { control: 'switch', tab: 'model', default: true, label: 'Bidirectional', help: 'Process the sequence in both directions.' },
            units: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Recurrent units', help: 'Number of units in the recurrent layer.' },
            recurrent_dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Recurrent dropout', help: 'Dropout applied to the recurrent state transitions.' },
            hidden_layers: hiddenLayersField([{ units: 64, activation: 'relu' }]),
            ...PRUNING_PARAMETERS
        },
        transformer: {
            ...PRUNING_PARAMETERS
        }
    },
    named_entity_recognition: {
        recurrent_neural_network: {
            sequence_length: { control: 'slider', tab: 'model', default: 128, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
            lstm_dims: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'LSTM dimensions', help: 'Number of units in the bidirectional LSTM layer.' }
        },
        transformer: {
            hidden_layers: hiddenLayersField([{ units: 768, activation: 'tanh' }])
        }
    },
    natural_language_understanding: {
        deep_neural_network: {
            units: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'LSTM units', help: 'Number of units in the bidirectional LSTM layer.' },
            intent_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Intent loss weight', help: 'Relative weight of the intent head in the combined loss.' },
            slot_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Slot loss weight', help: 'Relative weight of the slot head in the combined loss.' },
            monitor: { ...COMMON_PARAMETERS.monitor, options: NLU_MONITOR_OPTIONS },
            ...PRUNING_PARAMETERS
        },
        transformer: {
            intent_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Intent loss weight', help: 'Relative weight of the intent head in the combined loss.' },
            slot_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Slot loss weight', help: 'Relative weight of the slot head in the combined loss.' },
            monitor: { ...COMMON_PARAMETERS.monitor, options: NLU_MONITOR_OPTIONS }
        }
    }
};

// Resolved field metadata for one (model type, architecture) pair. Later
// spreads replace matching keys but keep their original insertion position,
// so tab ordering stays stable.
const resolveParameters = (modelType, architecture) => {
    const type = ARCHITECTURES_BY_MODEL[modelType] ? modelType : 'text_classification';
    return {
        ...COMMON_PARAMETERS,
        ...(ARCHITECTURE_PARAMETERS[architecture] || {}),
        ...(TYPE_OVERRIDES[type]?.[architecture] || {})
    };
};

const cloneDefault = (value) => (
    Array.isArray(value) ? value.map((item) => ({ ...item })) : value
);

const resolveDefaults = (modelType, architecture) => {
    const params = { architecture };
    Object.entries(resolveParameters(modelType, architecture)).forEach(([key, metadata]) => {
        params[key] = cloneDefault(metadata.default);
    });
    return params;
};

const getDefaultParameters = (modelType = 'text_classification') => {
    const architecture = ARCHITECTURES_BY_MODEL[modelType]?.[0] || 'deep_neural_network';
    return resolveDefaults(modelType, architecture);
};

const clampNumber = (value, { min, max }) => {
    let clamped = value;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return clamped;
};

// Coerces a value carried over from a previous training run into something
// the declared control can represent (sliders clamp, selects fall back to
// the default, layer lists are sanitised entry by entry).
const clampParameterValue = (metadata, value) => {
    if (metadata.control === 'layers') {
        if (!Array.isArray(value)) return cloneDefault(metadata.default);
        return value.slice(0, MAX_HIDDEN_LAYERS).map((layer) => ({
            units: clampNumber(Number(layer?.units) || HIDDEN_LAYER_UNITS.min, HIDDEN_LAYER_UNITS),
            activation: ACTIVATION_OPTIONS.some(([option]) => option === layer?.activation)
                ? layer.activation
                : 'relu'
        }));
    }
    if (metadata.control === 'slider') {
        return typeof value === 'number' ? clampNumber(value, metadata) : metadata.default;
    }
    if (metadata.control === 'select') {
        return metadata.options.some(([option]) => option === value) ? value : metadata.default;
    }
    if (metadata.control === 'switch') return Boolean(value);
    return value;
};

const getTrainingStartParameters = (modelType = 'text_classification', training = null) => {
    // Trainings recorded before the rename stored the value as max_seq_len.
    const { max_seq_len, ...previousParameters } = training?.kwargs || {};
    if (max_seq_len !== undefined && previousParameters.sequence_length === undefined) {
        previousParameters.sequence_length = max_seq_len;
    }
    const availableArchitectures = ARCHITECTURES_BY_MODEL[modelType] || ARCHITECTURES_BY_MODEL.text_classification;
    const architecture = availableArchitectures.includes(previousParameters.architecture)
        ? previousParameters.architecture
        : availableArchitectures[0];
    const registry = resolveParameters(modelType, architecture);
    const params = resolveDefaults(modelType, architecture);

    // Runs that predate hidden_layers stored the hidden dense as
    // units/activation; migrate them where units isn't a first-class field
    // (i.e. everywhere except the recurrent/LSTM sizes).
    if (registry.hidden_layers && previousParameters.hidden_layers === undefined && !registry.units) {
        const { units, activation } = previousParameters;
        if (units !== undefined || activation !== undefined) {
            const fallback = params.hidden_layers[0] || { units: 64, activation: 'relu' };
            previousParameters.hidden_layers = [{
                units: units ?? fallback.units,
                activation: activation ?? fallback.activation
            }];
        }
    }

    Object.entries(registry).forEach(([key, metadata]) => {
        if (previousParameters[key] === undefined) return;
        params[key] = clampParameterValue(metadata, previousParameters[key]);
    });
    params.architecture = architecture;
    return params;
};

// Sliders cannot leave their declared ranges, so only cross-field rules are
// validated. Keys map to the offending field for inline display.
const validateParameters = (params) => {
    const errors = {};
    if (params.pruning) {
        if (!(params.initial_sparsity < params.final_sparsity)) {
            errors.final_sparsity = 'Final sparsity must be greater than initial sparsity.';
        }
        if (!(params.pruning_end_step > params.pruning_begin_step)) {
            errors.pruning_end_step = 'Must be greater than the pruning begin step.';
        }
    }
    return errors;
};

const LOG_SLIDER_RESOLUTION = 100;
const toLogPosition = (metadata, value) => Math.round(
    LOG_SLIDER_RESOLUTION * Math.log(value / metadata.min) / Math.log(metadata.max / metadata.min)
);
const fromLogPosition = (metadata, position) => Number(
    (metadata.min * Math.pow(metadata.max / metadata.min, position / LOG_SLIDER_RESOLUTION)).toPrecision(2)
);

const formatSliderValue = (metadata, value) => {
    if (typeof value !== 'number') return String(value);
    if (metadata.scale === 'log' || (value !== 0 && Math.abs(value) < 0.001)) return value.toExponential();
    return String(value);
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

// Status filter for the trainings table. The three in-flight Celery states
// collapse to a single "active" option, matching how the UI groups them.
const TRAINING_FILTERS = [
    {
        name: 'status',
        label: 'Status',
        options: [
            { value: 'active', label: 'Active' },
            { value: 'SUCCESS', label: 'Success' },
            { value: 'FAILURE', label: 'Failure' },
            { value: 'ABORTED', label: 'Aborted' },
            { value: 'REVOKED', label: 'Revoked' }
        ]
    }
];
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
    const testAccuracy = getTrainingAccuracy(training);
    const active = isTrainingActive(training);
    // While a run is active the train accuracy streams in live via history;
    // once it succeeds the final evaluated train accuracy takes over.
    const trainAccuracy = training?.status === 'SUCCESS'
        ? getTrainingTrainAccuracy(training)
        : getLatestHistoryMetric(training, 'accuracy');
    const hasTestAccuracy = training?.status === 'SUCCESS' && testAccuracy !== null;
    const hasTrainAccuracy = trainAccuracy !== null && trainAccuracy !== undefined;

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
            label: 'Train / Test Accuracy',
            value: (
                <div className="d-flex align-items-center justify-content-between w-100">
                    <span className="fw-bold text-body-emphasis font-monospace">
                        {hasTrainAccuracy
                            ? `${(trainAccuracy * 100).toFixed(2)}`
                            : '—'}
                        /
                    {hasTestAccuracy
                        ? `${(testAccuracy * 100).toFixed(2)}`
                        : '—'}
                    </span>
                    {active && (
                        <Spinner
                            animation="border"
                            size="sm"
                            variant="primary"
                        />
                    )}
                </div>
            ),
            icon: <Percent />
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
                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
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
            value: <span className="fw-bold">{(bestAccuracy * 100).toFixed(2)}</span>,
            icon: <Percent />
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

    const [paramters, setParameters] = useState(getDefaultParameters(model?.kind));
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

    const controls = useTableControls({
        defaultSort: { field: 'created_at', order: 'desc' },
        filters: TRAINING_FILTERS,
        onChange: () => setPage(1)
    });
    const controlsKey = JSON.stringify(controls.params);

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
            setParameters(getTrainingStartParameters(model?.kind, currentTraining));
        }
    }, [model?.kind, currentTraining?.id, showParameters, showStartConfirmation]);

    const architectureOptions = ARCHITECTURES_BY_MODEL[model?.kind || 'text_classification'] || ['deep_neural_network'];
    const registry = resolveParameters(model?.kind, paramters.architecture);

    const handleArchitectureChange = (architecture) => {
        setParameters({
            ...resolveDefaults(model?.kind, architecture),
            save_format: paramters.save_format
        });
        setParameterErrors({});
    };

    const updateParameter = (field, value) => {
        const next = { ...paramters, [field]: value };
        setParameters(next);
        setParameterErrors(validateParameters(next));
    };

    const handleOpenStartTraining = () => {
        setParameters(getTrainingStartParameters(model?.kind, currentTraining));
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
    // confirmation, keeping the edits. Cross-field errors keep the form open
    // and switch to the callbacks tab that hosts them.
    const handleContinueTraining = (event) => {
        event.preventDefault();
        const errors = validateParameters(paramters);
        setParameterErrors(errors);
        if (Object.keys(errors).length > 0) {
            setTrainingTab('callbacks');
            return;
        }
        setShowStartConfirmation(true);
    };

    // Going back (or dismissing the confirmation) returns to the form.
    const handleBackToParameters = () => {
        if (startingTraining) return;
        setShowStartConfirmation(false);
    };

    const renderSliderControl = (field, metadata) => {
        const value = typeof paramters[field] === 'number' ? paramters[field] : metadata.default;
        const isLog = metadata.scale === 'log';
        return (
            <Form.Group className="mb-3" controlId={`training-${field}`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Label className="small fw-bold mb-0">{metadata.label}</Form.Label>
                    <span className="small text-muted font-monospace">{formatSliderValue(metadata, value)}</span>
                </div>
                <Form.Range
                    min={isLog ? 0 : metadata.min}
                    max={isLog ? LOG_SLIDER_RESOLUTION : metadata.max}
                    step={isLog ? 1 : metadata.step}
                    value={isLog ? toLogPosition(metadata, value) : value}
                    onChange={(e) => updateParameter(
                        field,
                        isLog ? fromLogPosition(metadata, parseInt(e.target.value)) : parseFloat(e.target.value)
                    )}
                />
                {parameterErrors[field] && (
                    <div className="small text-danger">{parameterErrors[field]}</div>
                )}
                <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
            </Form.Group>
        );
    };

    const renderSwitchControl = (field, metadata) => (
        <div className="mb-3">
            <Form.Check
                type="switch"
                id={`training-${field}`}
                className="small"
                label={metadata.label}
                checked={Boolean(paramters[field])}
                onChange={(e) => updateParameter(field, e.target.checked)}
            />
            <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
        </div>
    );

    const renderSelectControl = (field, metadata) => (
        <TrainingField id={`training-${field}`} label={metadata.label} help={metadata.help}>
            <Form.Select
                size="sm"
                value={paramters[field]}
                onChange={(e) => updateParameter(field, e.target.value)}
            >
                {metadata.options.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                ))}
            </Form.Select>
        </TrainingField>
    );

    const renderHiddenLayersControl = (field, metadata) => {
        const layers = Array.isArray(paramters[field]) ? paramters[field] : [];
        const updateLayer = (index, patch) => updateParameter(
            field,
            layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer))
        );
        return (
            <Form.Group className="mb-3" controlId={`training-${field}`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Label className="small fw-bold mb-0">{metadata.label}</Form.Label>
                    <Button
                        variant="light"
                        size="sm"
                        className="border py-0 px-2 small"
                        disabled={layers.length >= MAX_HIDDEN_LAYERS}
                        onClick={() => updateParameter(field, [...layers, { units: 64, activation: 'relu' }])}
                    >
                        <PlusLg />&nbsp;layer
                    </Button>
                </div>
                {layers.length === 0 && (
                    <div className="small text-muted fst-italic mb-1">
                        No hidden layers — the network connects straight to the output head.
                    </div>
                )}
                {layers.map((layer, index) => (
                    <div key={index} className="d-flex align-items-center gap-2 mb-2">
                        <span className="small text-muted font-monospace" style={{ width: '1.25rem' }}>{index + 1}</span>
                        <Form.Range
                            className="flex-grow-1"
                            min={HIDDEN_LAYER_UNITS.min}
                            max={HIDDEN_LAYER_UNITS.max}
                            step={HIDDEN_LAYER_UNITS.step}
                            value={layer.units}
                            onChange={(e) => updateLayer(index, { units: parseInt(e.target.value) })}
                        />
                        <span className="small text-muted font-monospace text-end" style={{ width: '3rem' }}>{layer.units}</span>
                        <Form.Select
                            size="sm"
                            style={{ width: '6.5rem' }}
                            value={layer.activation}
                            onChange={(e) => updateLayer(index, { activation: e.target.value })}
                        >
                            {ACTIVATION_OPTIONS.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </Form.Select>
                        <Button
                            variant="link"
                            className="p-0 text-danger"
                            aria-label={`Remove layer ${index + 1}`}
                            onClick={() => updateParameter(field, layers.filter((_, i) => i !== index))}
                        >
                            <Trash />
                        </Button>
                    </div>
                ))}
                <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
            </Form.Group>
        );
    };

    const renderTabFields = (tab) => (
        <Row>
            {Object.entries(registry)
                .filter(([, metadata]) => metadata.tab === tab)
                .map(([field, metadata]) => {
                    if (metadata.showIf && !metadata.showIf(paramters)) return null;
                    const fullWidth = ['switch', 'layers'].includes(metadata.control) || field === 'pretrained_model';
                    return (
                        <Col sm={fullWidth ? 12 : 6} key={field}>
                            {metadata.control === 'slider' && renderSliderControl(field, metadata)}
                            {metadata.control === 'switch' && renderSwitchControl(field, metadata)}
                            {metadata.control === 'select' && renderSelectControl(field, metadata)}
                            {metadata.control === 'layers' && renderHiddenLayersControl(field, metadata)}
                        </Col>
                    );
                })}
        </Row>
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
        if (field === 'hidden_layers') {
            return Array.isArray(value) && value.length > 0
                ? value.map((layer) => `${layer.units}·${layer.activation}`).join(' → ')
                : 'none';
        }
        if (typeof value === 'boolean') return value ? 'on' : 'off';
        return String(value);
    };

    const trainingSummary = Object.entries(paramters).map(([field, value]) => [
        field,
        registry[field]?.label || field.replace(/_/g, ' '),
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
                    let params = { extended: '1', page: page, per_page: perPage, ...controls.params };
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
    }, [user, modelId, page, perPage, debouncedQuery, controlsKey]);

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
                        <TableFilters controls={controls} dateRange />
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
            <FilterChips controls={controls} className="mt-3" />
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
                                        <SortHeader field="version" icon={<Hash />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Version</SortHeader>
                                        <SortHeader field="status" icon={<Activity />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Status</SortHeader>
                                        <SortHeader field="created_at" icon={<Clock />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Started</SortHeader>
                                        <SortHeader field="date_done" icon={<Calendar3 />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Completed</SortHeader>
                                        <SortHeader field="runtime" icon={<Stopwatch />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Runtime</SortHeader>
                                        <SortHeader field="train_accuracy" icon={<Percent />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Train accuracy</SortHeader>
                                        <SortHeader field="accuracy" icon={<Percent />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Test accuracy</SortHeader>
                                        <th><Option className="text-muted" />&nbsp;Options</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr >
                                            <td
                                                colSpan={8}
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
                                                    <Link to={`/models/${modelId}/history/${training.id}`} className="text-decoration-none font-monospace">
                                                        {training.version}
                                                    </Link>
                                                </td>
                                                <td>{getTrainingStatusBadge(training.status)}</td>
                                                <td className="small text-muted">{training.created_at}</td>
                                                <td className="small text-muted">{training.date_done}</td>
                                                <td className="small text-muted">{formatDuration(getTrainingRuntime(training)) || ''}</td>
                                                <td className="font-monospace">{(() => {
                                                    const trainAcc = training.status === 'SUCCESS'
                                                        ? getTrainingTrainAccuracy(training)
                                                        : getLatestHistoryMetric(training, 'accuracy');
                                                    return trainAcc !== null && trainAcc !== undefined ? (trainAcc * 100).toFixed(2) : '';
                                                })()}</td>
                                                <td className="font-monospace">{training.status === 'SUCCESS' && getTrainingAccuracy(training) !== null && (getTrainingAccuracy(training) * 100).toFixed(2)}</td>
                                                <td>
                                                    <Button
                                                        variant="light"
                                                        size="sm"
                                                        className="border me-1"
                                                        title={`Stop v${training.version}`}
                                                        aria-label={`Stop v${training.version}`}
                                                        disabled={!isTrainingActive(training) || stoppingTrainingIds.has(training.id)}
                                                        onClick={() => setTrainingAction({ type: 'stop', trainings: [training] })}
                                                    >
                                                        <StopCircleFill />
                                                    </Button>
                                                    <Button
                                                        variant="light"
                                                        size="sm"
                                                        className="border me-1"
                                                        title={`Retry v${training.version}`}
                                                        aria-label={`Retry v${training.version}`}
                                                        disabled={!isTrainingReady(training) || restartingTrainingIds.has(training.id)}
                                                        onClick={() => setTrainingAction({ type: 'retry', trainings: [training] })}
                                                    >
                                                        <ArrowClockwise />
                                                    </Button>
                                                    <Button
                                                        variant="light"
                                                        size="sm"
                                                        className="border text-danger"
                                                        title={`Delete v${training.version}`}
                                                        aria-label={`Delete v${training.version}`}
                                                        disabled={!isTrainingDeletable(training)}
                                                        onClick={() => handleOpenDeleteConfirmation([training])}
                                                    >
                                                        <Trash />
                                                    </Button>
                                                </td>
                                            </tr>
                                        )) : query !== '' ? (
                                            <tr>
                                                <td
                                                    colSpan={8}
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
                                                    colSpan={8}
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
                                        {renderTabFields('data')}
                                    </Tab>
                                    <Tab eventKey="model" title="Model">
                                        <TrainingField
                                            id="training-architecture"
                                            label="Architecture"
                                            help="Network architecture the model is built with. Changing it resets the settings below to the architecture defaults."
                                        >
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
                                        {renderTabFields('model')}
                                    </Tab>
                                    <Tab eventKey="schedule" title="Schedule">
                                        {renderTabFields('schedule')}
                                    </Tab>
                                    <Tab eventKey="callbacks" title="Callbacks">
                                        {renderTabFields('callbacks')}
                                    </Tab>
                                    <Tab eventKey="export" title="Export">
                                        {renderTabFields('export')}
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
