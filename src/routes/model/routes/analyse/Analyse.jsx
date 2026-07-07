import { Row, Col } from "react-bootstrap";
import { Activity } from "react-bootstrap-icons";
import { EmptyState } from "../../../../shared/components/SectionCard";

// Placeholder for the Analyse surface: the analytics endpoint it depends on
// is not available yet, so this page only reserves the route.
const Analyse = () => (
    <Row className="mt-4 pb-5">
        <Col>
            <EmptyState icon={<Activity />} minHeight="320px">
                Analytics isn't available yet. Prediction insights for this model will appear here.
            </EmptyState>
        </Col>
    </Row>
);

export default Analyse;
