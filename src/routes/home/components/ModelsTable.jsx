import { Badge, Card, Form, Spinner, Table } from "react-bootstrap";
import { Boxes, Calendar3, Clock, InfoCircle, Search, Stack } from "react-bootstrap-icons";
import { Link } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../shared/components/SectionCard";

const ModelsTable = ({
    loading,
    models,
    total,
    query,
    selectedIds,
    onToggleRow,
    onToggleAll
}) => {
    const allSelected = models.length > 0 && models.every((model) => selectedIds.has(model.id));

    return (
        <Card className="border-light overflow-hidden">
            <CardHeading
                icon={<Boxes />}
                title="Models"
                right={
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                        {total} model{total === 1 ? "" : "s"}
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
                                    onChange={() => onToggleAll(models)}
                                    disabled={loading || models.length === 0}
                                />
                            </th>
                            <th><Boxes className="text-muted" />&nbsp;Name</th>
                            <th><Stack className="text-muted" />&nbsp;Type</th>
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
                        ) : total > 0 ? models.map((model) => (
                            <tr key={model.id}>
                                <td>
                                    <Form.Check
                                        type="checkbox"
                                        checked={selectedIds.has(model.id)}
                                        onChange={() => onToggleRow(model.id)}
                                    />
                                </td>
                                <td>
                                    <Link
                                        to={`/models/${model.id}/build`}
                                        className="text-decoration-none"
                                        title={model.description || undefined}
                                    >
                                        {model.name}
                                    </Link>
                                </td>
                                <td>
                                    <Badge bg="light" text="dark" className="border fw-normal font-monospace">
                                        {(model.kind || "").replace(/_/g, " ")}
                                    </Badge>
                                </td>
                                <td className="small text-muted">{model.created_at}</td>
                                <td className="small text-muted">{model.updated_at}</td>
                            </tr>
                        )) : query !== "" ? (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<Search />}>
                                        could not find the model you are looking for.
                                    </EmptyMessage>
                                </td>
                            </tr>
                        ) : (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<InfoCircle />}>
                                        looks like you have no models.
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

export default ModelsTable;
