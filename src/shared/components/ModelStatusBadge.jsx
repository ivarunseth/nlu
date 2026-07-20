import { Badge } from "react-bootstrap";

// Colour per deployment stage, echoing the environment badges on the Publish
// page (testing → info, production → success) and extending the scale down to
// development. `status` is the furthest environment a model has reached, or a
// falsy value when nothing is deployed.
const STATUS_VARIANT = {
    development: "secondary",
    testing: "info",
    production: "success"
};

const ModelStatusBadge = ({ status }) => {
    if (!status || !STATUS_VARIANT[status]) {
        return <span className="text-muted small">-</span>;
    }
    return (
        <Badge bg={STATUS_VARIANT[status]} className="text-capitalize fw-normal">
            {status}
        </Badge>
    );
};

export default ModelStatusBadge;
