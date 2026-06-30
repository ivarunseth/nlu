import { Dropdown, Spinner, Table } from "react-bootstrap";
import { Download, InfoCircle, Pen, Trash } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const LabelsTable = ({
    modelId,
    loading,
    labels,
    total,
    query,
    page,
    perPage,
    onDownload,
    onEdit,
    onDelete
}) => (
    <Table
        responsive
        hover
        style={{
            minHeight: "33vh",
            textAlign: "center"
        }}
    >
        <thead>
            <tr>
                <th>#</th>
                <th>name</th>
                <th>count of utterances</th>
                <th>created at</th>
                <th>updated at</th>
                <th>options</th>
            </tr>
        </thead>
        <tbody>
            {loading ? (
                <tr>
                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                        <Spinner animation="border" size="lg" />
                    </td>
                </tr>
            ) : total > 0 ? labels.map((label, index) => (
                <tr key={label.id}>
                    <td>{(page - 1) * perPage + index + 1}.</td>
                    <td>
                        <Link
                            to={`/models/${modelId}/build/${label.id}/utterances`}
                            style={{ textDecorationLine: "none" }}
                        >
                            {label.name}
                        </Link>
                    </td>
                    <td>{label.utterances_count}</td>
                    <td>{label.created_at}</td>
                    <td>{label.updated_at}</td>
                    <td>
                        <Dropdown>
                            <Dropdown.Toggle size="sm" variant="light">
                                select
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                                <Dropdown.Item onClick={() => onDownload(label)}>
                                    <Download />
                                    &nbsp;
                                    Download
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => onEdit(label)}>
                                    <Pen />
                                    &nbsp;
                                    Edit
                                </Dropdown.Item>
                                <Dropdown.Divider />
                                <Dropdown.Item onClick={() => onDelete(label)}>
                                    <Trash />
                                    &nbsp;
                                    Delete
                                </Dropdown.Item>
                            </Dropdown.Menu>
                        </Dropdown>
                    </td>
                </tr>
            )) : query !== "" ? (
                <tr>
                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                        <i className="bi bi-ban" />&nbsp;could not find the label you are looking for.
                    </td>
                </tr>
            ) : (
                <tr>
                    <td colSpan={6} style={{ verticalAlign: "middle" }}>
                        <InfoCircle />&nbsp;looks like you have no labels.
                    </td>
                </tr>
            )}
        </tbody>
    </Table>
);

export default LabelsTable;
