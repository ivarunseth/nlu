import { Dropdown, Spinner, Table } from "react-bootstrap";
import { Download, InfoCircle, Pen, Trash } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const ModelsTable = ({
    loading,
    models,
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
                <th>created at</th>
                <th>updated at</th>
                <th>options</th>
            </tr>
        </thead>
        <tbody>
            {loading ? (
                <tr>
                    <td colSpan={5} style={{ verticalAlign: "middle" }}>
                        <Spinner animation="border" size="lg" />
                    </td>
                </tr>
            ) : total > 0 ? models.map((model, index) => (
                <tr key={model.id}>
                    <td>{(page - 1) * perPage + index + 1}.</td>
                    <td>
                        <Link
                            to={`/models/${model.id}/build`}
                            style={{ textDecorationLine: "none" }}
                        >
                            {model.name}
                        </Link>
                    </td>
                    <td>{model.created_at}</td>
                    <td>{model.updated_at}</td>
                    <td>
                        <Dropdown>
                            <Dropdown.Toggle size="sm" variant="light">
                                select
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                                <Dropdown.Item onClick={() => onDownload(model)}>
                                    <Download />
                                    &nbsp;
                                    Download
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => onEdit(model)}>
                                    <Pen />
                                    &nbsp;
                                    Edit
                                </Dropdown.Item>
                                <Dropdown.Divider />
                                <Dropdown.Item onClick={() => onDelete(model)}>
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
                    <td colSpan={5} style={{ verticalAlign: "middle" }}>
                        <i className="bi bi-ban" />&nbsp;could not find the model you are looking for.
                    </td>
                </tr>
            ) : (
                <tr>
                    <td colSpan={5} style={{ verticalAlign: "middle" }}>
                        <InfoCircle />&nbsp;looks like you have no models.
                    </td>
                </tr>
            )}
        </tbody>
    </Table>
);

export default ModelsTable;
