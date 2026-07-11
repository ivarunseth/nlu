import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";

// Same palette and axis/tooltip styling as History's charts.
export const COLORS = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7'];
export const [BLUE, ORANGE, RED, TEAL, GREEN] = COLORS;

const TICK = { fontSize: 10 };
const MARGIN = { top: 10, right: 10, left: 0, bottom: 10 };

export const TIP = {
    contentStyle: {
        fontSize: '11px',
        border: '1px solid var(--bs-border-color)',
        borderRadius: '4px',
        backgroundColor: 'var(--bs-body-bg)',
        color: 'var(--bs-body-color)'
    },
    itemStyle: { padding: '1px 0' }
};

// Utterances per label (or spans per entity), with the largest and smallest
// classes highlighted — unless `colored`, which paints each bar in the
// entity's stored colour so the chart speaks Build's colour language.
export const LabelBars = ({ labels, imbalance, colored = false, name = 'utterances' }) => (
    <ResponsiveContainer>
        <BarChart data={labels} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={TICK} interval={0} angle={-30} textAnchor="end" height={50} />
            <YAxis allowDecimals={false} tick={TICK} />
            <Tooltip {...TIP} cursor={{ fill: 'var(--bs-secondary-bg)' }} />
            <Bar dataKey="count" name={name} isAnimationActive={false}>
                {labels.map((label) => (
                    <Cell
                        key={label.id}
                        fill={colored && label.color ? label.color
                            : label.name === imbalance?.max?.name ? GREEN
                                : label.name === imbalance?.min?.name ? RED
                                    : BLUE}
                    />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
);

// Histogram over precomputed bins; rows carry a `range` x label and `n` count.
export const Hist = ({ bins, color = BLUE, name = 'utterances' }) => (
    <ResponsiveContainer>
        <BarChart data={bins} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="range" tick={TICK} interval={0} angle={-30} textAnchor="end" height={50} />
            <YAxis allowDecimals={false} tick={TICK} />
            <Tooltip {...TIP} cursor={{ fill: 'var(--bs-secondary-bg)' }} />
            <Bar dataKey="n" name={name} fill={color} isAnimationActive={false} />
        </BarChart>
    </ResponsiveContainer>
);

// Cross-version line chart; `lines` is [{ key, color }] over `data` keyed by version.
export const TrendLines = ({ data, lines, domain = [0, 1] }) => (
    <ResponsiveContainer>
        <LineChart data={data} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="version" tick={TICK} tickFormatter={(v) => `v${v}`} />
            <YAxis domain={domain} tick={TICK} />
            <Tooltip {...TIP} labelFormatter={(v) => `v${v}`} />
            {lines.map((line) => (
                <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: line.color }}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls
                    isAnimationActive={false}
                />
            ))}
        </LineChart>
    </ResponsiveContainer>
);

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Time-bucketed series; `data` rows carry an epoch-second `t`.
export const TimeLines = ({ data, lines }) => (
    <ResponsiveContainer>
        <LineChart data={data} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tick={TICK} tickFormatter={hhmm} minTickGap={32} />
            <YAxis allowDecimals={false} tick={TICK} />
            <Tooltip {...TIP} labelFormatter={(t) => new Date(t * 1000).toLocaleString()} />
            {lines.map((line) => (
                <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    isAnimationActive={false}
                />
            ))}
        </LineChart>
    </ResponsiveContainer>
);

// Train-minus-test accuracy per version; bars above `limit` are flagged red.
export const GapBars = ({ data, limit = 0.1 }) => (
    <ResponsiveContainer>
        <BarChart data={data} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="version" tick={TICK} tickFormatter={(v) => `v${v}`} />
            <YAxis tick={TICK} />
            <Tooltip {...TIP} labelFormatter={(v) => `v${v}`} />
            <Bar dataKey="gap" name="train − test" isAnimationActive={false}>
                {data.map((row) => (
                    <Cell key={row.version} fill={row.gap > limit ? RED : BLUE} />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
);
