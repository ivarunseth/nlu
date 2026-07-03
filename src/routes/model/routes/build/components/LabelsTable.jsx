import { Badge, Card, Form, Spinner, Table } from "react-bootstrap";
import { Calendar3, BlockquoteLeft, Clock, InfoCircle, Search, Tag, Tags } from "react-bootstrap-icons";
import { Link } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

const LabelsTable = ({
    modelId,
    loading,
    labels,
    total,
    query,
    selectedIds,
    onToggleRow,
    onToggleAll
}) => {
    const allSelected = labels.length > 0 && labels.every((label) => selectedIds.has(label.id));

    return (
        <Card className="border-light overflow-hidden">
            <CardHeading
                icon={<Tags />}
                title="Labels"
                right={
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                        {total} label{total === 1 ? "" : "s"}
                    </span>
                }
            />
            <Card.Body className="p-0">
                <Table
                    responsive
                    hover
                    className="mb-0 align-middle text-center"
                    style={{ minHeight: "33vh" }}
                >
                    <thead>
                        <tr>
                            <th style={{ width: "40px" }}>
                                <Form.Check
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={() => onToggleAll(labels)}
                                    disabled={loading || labels.length === 0}
                                />
                            </th>
                            <th><Tag className="text-muted" />&nbsp;Name</th>
                            <th><BlockquoteLeft className="text-muted" />&nbsp;Utterances</th>
                            <th><Calendar3 className="text-muted" />&nbsp;Created</th>
                            <th><Clock className="text-muted" />&nbsp;Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <Spinner animation="border" size="lg" />
                                </td>
                            </tr>
                        ) : total > 0 ? labels.map((label) => (
                            <tr key={label.id}>
                                <td>
                                    <Form.Check
                                        type="checkbox"
                                        checked={selectedIds.has(label.id)}
                                        onChange={() => onToggleRow(label.id)}
                                    />
                                </td>
                                <td>
                                    <Link
                                        to={`/models/${modelId}/build/${label.id}/utterances`}
                                        className="text-decoration-none"
                                    >
                                        {label.name}
                                    </Link>
                                </td>
                                <td>
                                    <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                        {label.utterances_count}
                                    </Badge>
                                </td>
                                <td className="small text-muted">{label.created_at}</td>
                                <td className="small text-muted">{label.updated_at}</td>
                            </tr>
                        )) : query !== "" ? (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<Search />}>
                                        could not find the label you are looking for.
                                    </EmptyMessage>
                                </td>
                            </tr>
                        ) : (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<InfoCircle />}>
                                        looks like you have no labels.
                                    </EmptyMessage>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            </Card.Body>
        </Card>
    );
};

export default LabelsTable;
