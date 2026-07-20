import { Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import { Boxes, Broadcast, Calendar3, Clock, Download, Gear, InfoCircle, Option, Search, Stack } from "react-bootstrap-icons";
import { Link } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../shared/components/SectionCard";
import ModelStatusBadge from "../../../shared/components/ModelStatusBadge";
import SortHeader from "../../../shared/components/SortHeader";

const ModelsTable = ({
    loading,
    models,
    total,
    query,
    controls,
    onDownload
}) => (
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
                        <SortHeader field="name" icon={<Boxes />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Name</SortHeader>
                        <SortHeader field="kind" icon={<Stack />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Type</SortHeader>
                        <th><Broadcast className="text-muted" />&nbsp;Status</th>
                        <SortHeader field="created_at" icon={<Calendar3 />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Created</SortHeader>
                        <SortHeader field="updated_at" icon={<Clock />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Updated</SortHeader>
                        <th><Option className="text-muted" />&nbsp;Options</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={6} style={{ verticalAlign: "middle" }}>
                                <Spinner animation="border" size="lg" />
                            </td>
                        </tr>
                    ) : total > 0 ? models.map((model) => (
                        <tr key={model.id}>
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
                            <td>
                                <ModelStatusBadge status={model.status} />
                            </td>
                            <td className="small text-muted">{model.created_at}</td>
                            <td className="small text-muted">{model.updated_at}</td>
                            <td>
                                <Button
                                    variant="light"
                                    size="sm"
                                    className="border me-1"
                                    title={`Download ${model.name}`}
                                    aria-label={`Download ${model.name}`}
                                    onClick={() => onDownload(model)}
                                >
                                    <Download />
                                </Button>
                                <Button
                                    as={Link}
                                    to={`/models/${model.id}/settings`}
                                    variant="light"
                                    size="sm"
                                    className="border"
                                    title={`Settings for ${model.name}`}
                                    aria-label={`Settings for ${model.name}`}
                                >
                                    <Gear />
                                </Button>
                            </td>
                        </tr>
                    )) : query !== "" ? (
                        <tr>
                            <td colSpan={6} style={{ verticalAlign: "middle" }}>
                                <EmptyMessage icon={<Search />}>
                                    could not find the model you are looking for.
                                </EmptyMessage>
                            </td>
                        </tr>
                    ) : (
                        <tr>
                            <td colSpan={6} style={{ verticalAlign: "middle" }}>
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

export default ModelsTable;
