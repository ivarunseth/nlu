import { Form, InputGroup } from "react-bootstrap";
import FormModal from "../../../../../shared/components/FormModal";
import FileDropzone from "../../../../../shared/components/FileDropzone";

const LabelFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    dataset,
    header,
    onHide,
    onSubmit,
    onNameChange,
    onDatasetChange,
    onHeaderChange
}) => (
    <FormModal
        show={show}
        title={title}
        validated={validated}
        submitting={submitting}
        onHide={onHide}
        onSubmit={onSubmit}
    >
        <Form.Group className="mb-3">
            <InputGroup hasValidation>
                <Form.Floating>
                    <Form.Control
                        id="label-name"
                        type="text"
                        placeholder="Enter a name..."
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        autoFocus
                        required
                    />
                    <Form.Label htmlFor="label-name">Name</Form.Label>
                    <Form.Control.Feedback type="invalid">
                        Please enter a name.
                    </Form.Control.Feedback>
                </Form.Floating>
            </InputGroup>
            <Form.Text muted>
                Choose a unique name for the label.
            </Form.Text>
        </Form.Group>
        <Form.Group className="mb-3">
            <Form.Label htmlFor="label-dataset">Dataset</Form.Label>
            <FileDropzone
                id="label-dataset"
                file={dataset}
                onSelect={onDatasetChange}
                accept=".csv,.tsv"
                prompt="Drag and drop a dataset here, or click to browse."
                hint="Comma or tab separated text and labels · optional"
            />
        </Form.Group>
        <Form.Group>
            <Form.Check
                type="checkbox"
                label="contains header"
                disabled={!dataset}
                onChange={(e) => onHeaderChange(e.target.checked)}
                checked={header}
            />
            <Form.Text muted>
                Check only if the dataset contains a header with column names.
            </Form.Text>
        </Form.Group>
    </FormModal>
);

export default LabelFormModal;
