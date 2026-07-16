import { Card, Col, Row } from "react-bootstrap";

// A compact overview strip of dataset-health metrics — a responsive row of
// small cards (icon + label + value, with an optional muted sub-value).
// Rendered above a Build workspace so coverage is visible at a glance. Shared
// by the NER, intent and entity surfaces; each caller passes its own `items`
// as `{ label, value, sub?, icon }`, and `className` tunes the top margin.
const MetricsStrip = ({ items, className = "mt-1" }) => (
    <Row className={`g-3 ${className}`}>
        {items.map((item, index) => (
            <Col key={index} xs={6} md={3} lg={true}>
                <Card className="h-100">
                    <Card.Body className="p-3 d-flex align-items-center">
                        <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            <div className="text-muted small fw-bold" style={{ fontSize: "0.65rem" }}>{item.label}</div>
                            <div className="text-body-emphasis small fw-medium text-truncate">
                                {item.value ?? "-"}
                                {item.sub && <span className="text-muted fw-normal ms-1">{item.sub}</span>}
                            </div>
                        </div>
                    </Card.Body>
                </Card>
            </Col>
        ))}
    </Row>
);

export default MetricsStrip;
