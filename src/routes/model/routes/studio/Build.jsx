import { useContext } from "react";
import { Spinner } from "react-bootstrap";
import { ModelContext } from "../../../../contexts/ModelContext";
import AnnotationBuild from "./AnnotationBuild";
import ClassificationBuild from "./ClassificationBuild";
import UnderstandingBuild from "./UnderstandingBuild";

// Build branches on the model type: classification models manage labels that
// own whole utterances, named entity recognition models manage an entity
// registry and annotate spans inside model-scoped utterances, and language
// understanding models compose both over one shared utterance set.
const Build = () => {
    const { model } = useContext(ModelContext);

    if (!model) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "50vh" }}>
                <Spinner animation="border" size="lg" />
            </div>
        );
    }

    if (model.kind === "named_entity_recognition") return <AnnotationBuild />;
    if (model.kind === "natural_language_understanding") return <UnderstandingBuild />;
    return <ClassificationBuild />;
};

export default Build;
