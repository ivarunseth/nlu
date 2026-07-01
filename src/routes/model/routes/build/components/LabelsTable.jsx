import { Form, Spinner, Table } from "react-bootstrap";
import { InfoCircle } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

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
                            onChange={() => onToggleAll(labels)}
                            disabled={loading || labels.length === 0}
                        />
                    </th>
                    <th>name</th>
                    <th>count of utterances</th>
                    <th>created at</th>
                    <th>updated at</th>
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
                                style={{ textDecorationLine: "none" }}
                            >
                                {label.name}
                            </Link>
                        </td>
                        <td>{label.utterances_count}</td>
                        <td>{label.created_at}</td>
                        <td>{label.updated_at}</td>
                    </tr>
                )) : query !== "" ? (
                    <tr>
                        <td colSpan={5} style={{ verticalAlign: "middle" }}>
                            <i className="bi bi-ban" />&nbsp;could not find the label you are looking for.
                        </td>
                    </tr>
                ) : (
                    <tr>
                        <td colSpan={5} style={{ verticalAlign: "middle" }}>
                            <InfoCircle />&nbsp;looks like you have no labels.
                        </td>
                    </tr>
                )}
            </tbody>
        </Table>
    );
};

export default LabelsTable;
