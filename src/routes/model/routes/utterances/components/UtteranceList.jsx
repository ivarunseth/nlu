import { ListGroup, Spinner } from "react-bootstrap";
import { InfoCircle, Trash } from "react-bootstrap-icons";

const UtteranceList = ({
    loading,
    utterances,
    total,
    query,
    page,
    perPage,
    onEdit,
    onDelete
}) => (
    <ListGroup>
        {loading ? (
            <ListGroup.Item
                className="d-flex justify-content-center align-items-center"
                style={{ minHeight: "50vh" }}
            >
                <Spinner animation="border" size="lg" />
            </ListGroup.Item>
        ) : total > 0 ? utterances.map((utterance, index) => (
            <ListGroup.Item
                key={utterance.id}
                className="d-flex justify-content-between align-items-start"
            >
                <div className="me-1">
                    {(page - 1) * perPage + index + 1}.
                </div>
                <div
                    className="me-auto px-1"
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: utterance.text }}
                    onBlur={(e) => onEdit(utterance.id, e.currentTarget.textContent)}
                />
                <div className="ms-1">
                    <Trash
                        onClick={() => onDelete(utterance.id)}
                        style={{ cursor: "pointer" }}
                    />
                </div>
            </ListGroup.Item>
        )) : query !== "" ? (
            <ListGroup.Item
                className="d-flex justify-content-center align-items-center"
                style={{ minHeight: "50vh" }}
            >
                <i className="bi bi-ban" />&nbsp;could not find the model you are looking for.
            </ListGroup.Item>
        ) : (
            <ListGroup.Item
                className="d-flex justify-content-center align-items-center"
                style={{ minHeight: "50vh" }}
            >
                <InfoCircle />&nbsp;looks like you have no utterances.
            </ListGroup.Item>
        )}
    </ListGroup>
);

export default UtteranceList;
