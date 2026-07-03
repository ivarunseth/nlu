import { Button, Card, ListGroup, Spinner } from "react-bootstrap";
import { Quote, InfoCircle, Search, Trash } from "react-bootstrap-icons";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

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
    <Card className="border-light overflow-hidden">
        <CardHeading
            icon={<Quote />}
            title="Utterances"
            right={
                <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                    {total} utterance{total === 1 ? "" : "s"}
                </span>
            }
        />
        <ListGroup variant="flush">
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
                    className="d-flex justify-content-between align-items-center gap-2 py-2"
                >
                    <div className="text-muted small font-monospace" style={{ minWidth: "2rem", textAlign: "right" }}>
                        {(page - 1) * perPage + index + 1}.
                    </div>
                    <div
                        className="me-auto px-1 text-break"
                        contentEditable
                        suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: utterance.text }}
                        onBlur={(e) => onEdit(utterance.id, e.currentTarget.textContent)}
                    />
                    <Button
                        variant="light"
                        size="sm"
                        className="border text-danger d-inline-flex align-items-center flex-shrink-0"
                        title="Delete utterance"
                        aria-label="Delete utterance"
                        onClick={() => onDelete(utterance.id)}
                    >
                        <Trash />
                    </Button>
                </ListGroup.Item>
            )) : query !== "" ? (
                <ListGroup.Item
                    className="d-flex justify-content-center align-items-center"
                    style={{ minHeight: "50vh" }}
                >
                    <EmptyMessage icon={<Search />}>
                        could not find the utterance you are looking for.
                    </EmptyMessage>
                </ListGroup.Item>
            ) : (
                <ListGroup.Item
                    className="d-flex justify-content-center align-items-center"
                    style={{ minHeight: "50vh" }}
                >
                    <EmptyMessage icon={<InfoCircle />}>
                        looks like you have no utterances.
                    </EmptyMessage>
                </ListGroup.Item>
            )}
        </ListGroup>
    </Card>
);

export default UtteranceList;
