import { Card, Col, Row } from "react-bootstrap";

// Compact metric strip, mirroring the MetricStrip cards in History and Test.
const Strip = ({ items, className = "" }) => (
    <Row className={`g-3 ${className}`}>
        {items.map((item, index) => (
            <Col key={index} xs={12} sm={6} md={4} lg={true}>
                <Card className="h-100">
                    <Card.Body className="p-3 d-flex align-items-center">
                        <div className="text-primary me-3 fs-4 lh-1">{item.icon}</div>
                        <div className="flex-grow-1">
                            <div className="text-muted small fw-bold" style={{ fontSize: "0.65rem" }}>{item.label}</div>
                            <div className="text-body-emphasis small fw-medium">{item.value ?? "-"}</div>
                        </div>
                    </Card.Body>
                </Card>
            </Col>
        ))}
    </Row>
);

export default Strip;
