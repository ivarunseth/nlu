import { Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import { Calendar3, BlockquoteLeft, Clock, Download, InfoCircle, Option, Pen, Search, Tag, Trash, Bookmarks } from "react-bootstrap-icons";
import { Link } from "react-router-dom";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";
import SortHeader from "../../../../../shared/components/SortHeader";

const LabelsTable = ({
    modelId,
    noun = "label",
    loading,
    labels,
    total,
    query,
    controls,
    onDownload,
    onEdit,
    onDelete,
    // Where a row's name links to; language understanding overrides this so
    // an intent drills into its workspace instead of the utterances page.
    labelLink
}) => {
    const linkTo = labelLink || ((label) => `/models/${modelId}/build/${label.id}/utterances`);

    return (
        <Card className="border-light overflow-hidden">
            <CardHeading
                icon={<Bookmarks />}
                title={`${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`}
                right={
                    <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                        {total} {noun}{total === 1 ? "" : "s"}
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
                            <SortHeader field="name" icon={<Tag />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Name</SortHeader>
                            <SortHeader field="utterances_count" icon={<BlockquoteLeft />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Utterances</SortHeader>
                            <SortHeader field="created_at" icon={<Calendar3 />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Created</SortHeader>
                            <SortHeader field="updated_at" icon={<Clock />} sort={controls.sort} order={controls.order} onSort={controls.toggleSort}>Updated</SortHeader>
                            <th><Option className="text-muted" />&nbsp;Options</th>
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
                                    <Link
                                        to={linkTo(label)}
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
                                <td>
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border me-1"
                                        title={`Download ${label.name}`}
                                        aria-label={`Download ${label.name}`}
                                        onClick={() => onDownload(label)}
                                    >
                                        <Download />
                                    </Button>
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border me-1"
                                        title={`Edit ${label.name}`}
                                        aria-label={`Edit ${label.name}`}
                                        onClick={() => onEdit(label)}
                                    >
                                        <Pen />
                                    </Button>
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border text-danger"
                                        title={`Delete ${label.name}`}
                                        aria-label={`Delete ${label.name}`}
                                        onClick={() => onDelete(label)}
                                    >
                                        <Trash />
                                    </Button>
                                </td>
                            </tr>
                        )) : query !== "" ? (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<Search />}>
                                        could not find the {noun} you are looking for.
                                    </EmptyMessage>
                                </td>
                            </tr>
                        ) : (
                            <tr>
                                <td colSpan={5} style={{ verticalAlign: "middle" }}>
                                    <EmptyMessage icon={<InfoCircle />}>
                                        looks like you have no {noun}s.
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
