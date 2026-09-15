import { InfoCircle } from "react-bootstrap-icons";

// Design primitives shared by the Test, Publish, Home, Build and History
// pages: uppercase section labels, card header bars and empty states.

export const SectionLabel = ({ children }) => (
    <span className="small fw-bold text-muted text-uppercase" style={{ fontSize: "var(--app-text-xs)", letterSpacing: "0.04em" }}>
        {children}
    </span>
);

export const CardHeading = ({ icon, title, right }) => (
    <div className="d-flex align-items-center justify-content-between px-3 py-2 bg-body-tertiary border-bottom border-light-subtle">
        <span className="d-inline-flex align-items-center gap-2 text-body-emphasis">
            <span className="text-primary lh-1">{icon}</span>
            <SectionLabel>{title}</SectionLabel>
        </span>
        {right}
    </div>
);

export const EmptyState = ({ icon, children, minHeight = "260px" }) => (
    <div
        className="d-flex align-items-center justify-content-center text-muted"
        style={{ minHeight, border: "1px solid var(--bs-border-color)", borderRadius: "var(--bs-border-radius-sm)", background: "var(--bs-body-bg)" }}
    >
        <div className="text-center px-3">
            <div className="fs-3 mb-2 opacity-50">{icon || <InfoCircle />}</div>
            <p className="mb-0 small fw-bold">{children}</p>
        </div>
    </div>
);

// Borderless variant for use inside an already-framed container (table cell,
// list group item, card body).
export const EmptyMessage = ({ icon, children }) => (
    <div className="d-flex flex-column align-items-center justify-content-center text-muted py-5">
        <div className="fs-3 mb-2 opacity-50">{icon || <InfoCircle />}</div>
        <p className="mb-0 small fw-bold">{children}</p>
    </div>
);
