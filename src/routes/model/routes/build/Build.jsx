import { useContext } from "react";
import { Spinner } from "react-bootstrap";
import { ModelContext } from "../../../../contexts/ModelContext";
import AnnotationBuild from "./AnnotationBuild";
import ClassificationBuild from "./ClassificationBuild";

// Build branches on the model type: classification models manage labels that
// own whole utterances, while named entity recognition models manage an
// entity registry and annotate spans inside model-scoped utterances.
const Build = () => {
    const { model } = useContext(ModelContext);

    if (!model) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "50vh" }}>
                <Spinner animation="border" size="lg" />
            </div>
        );
    }

    return model.type === "named_entity_recognition" ? <AnnotationBuild /> : <ClassificationBuild />;
};

export default Build;
