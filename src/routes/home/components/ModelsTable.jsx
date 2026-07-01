import { Form, Spinner, Table } from "react-bootstrap";
import { InfoCircle } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

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
                    <th style={{ width: "40px" }}>
                        <Form.Check
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => onToggleAll(models)}
                            disabled={loading || models.length === 0}
                        />
                    </th>
                    <th>name</th>
                    <th>created at</th>
                    <th>updated at</th>
                </tr>
            </thead>
            <tbody>
                {loading ? (
                    <tr>
                        <td colSpan={4} style={{ verticalAlign: "middle" }}>
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
                                style={{ textDecorationLine: "none" }}
                            >
                                {model.name}
                            </Link>
                        </td>
                        <td>{model.created_at}</td>
                        <td>{model.updated_at}</td>
                    </tr>
                )) : query !== "" ? (
                    <tr>
                        <td colSpan={4} style={{ verticalAlign: "middle" }}>
                            <i className="bi bi-ban" />&nbsp;could not find the model you are looking for.
                        </td>
                    </tr>
                ) : (
                    <tr>
                        <td colSpan={4} style={{ verticalAlign: "middle" }}>
                            <InfoCircle />&nbsp;looks like you have no models.
                        </td>
                    </tr>
                )}
            </tbody>
        </Table>
    );
};

export default ModelsTable;
