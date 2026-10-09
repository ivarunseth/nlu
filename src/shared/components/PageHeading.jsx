// The heading row a Build workspace opens with: a title (optionally led by
// the record's colour dot), anything that belongs beside it, and actions on
// the right. Registry lists ("Intents") and drill-ins (an intent, a label, an
// entity) share it, so the name lands in the same place either way.
const PageHeading = ({ title, color, beside, children, className = "mt-4" }) => (
    <div className={`d-flex align-items-center gap-2 ${className}`.trim()}>
        <h5 className="mb-0 d-flex align-items-center gap-2 text-truncate">
            {color && (
                <span
                    className="rounded-circle d-inline-block flex-shrink-0"
                    style={{ width: "0.6rem", height: "0.6rem", background: color }}
                    aria-hidden="true"
                />
            )}
            <span className="text-truncate">{title ?? "…"}</span>
        </h5>
        {beside}
        <div className="flex-grow-1" />
        {children}
    </div>
);

export default PageHeading;
