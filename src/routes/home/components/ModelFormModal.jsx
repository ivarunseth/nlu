import { Form, InputGroup } from "react-bootstrap";
import FormModal from "../../../shared/components/FormModal";

const ModelFormModal = ({
    show,
    title,
    validated,
    submitting,
    name,
    type,
    dataset,
    header,
    description,
    showType = false,
    onHide,
    onSubmit,
    onNameChange,
    onTypeChange,
    onDatasetChange,
    onHeaderChange,
    onDescriptionChange
}) => (
    <FormModal
        show={show}
        title={title}
        validated={validated}
        submitting={submitting}
        size="lg"
        onHide={onHide}
        onSubmit={onSubmit}
    >
        <Form.Group className="mb-3">
            <InputGroup hasValidation>
                <Form.Floating>
                    <Form.Control
                        id="model-name"
                        type="text"
                        placeholder="Enter a name..."
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        autoFocus
                        required
                    />
                    <Form.Label htmlFor="model-name">Name</Form.Label>
                    <Form.Control.Feedback type="invalid">
                        Please enter a name.
                    </Form.Control.Feedback>
                </Form.Floating>
            </InputGroup>
            <Form.Text muted>
                Choose a unique name for your model.
            </Form.Text>
        </Form.Group>
        {showType && (
            <Form.Group className="mb-3">
                <Form.Floating>
                    <Form.Select id="model-type" value={type} onChange={(e) => onTypeChange(e.target.value)}>
                        <option value="text_classification">Text classification</option>
                        <option value="named_entity_recognition">Named entity recognition</option>
                        <option value="natural_language_understanding">Language understanding</option>
                    </Form.Select>
                    <Form.Label htmlFor="model-type">Type</Form.Label>
                </Form.Floating>
                <Form.Text muted>
                    Select the type that matches the model you want to create.
                </Form.Text>
            </Form.Group>
        )}
        <Form.Group className="mb-3">
            <Form.Label>Dataset</Form.Label>
            <Form.Control
                type="file"
                onChange={(e) => onDatasetChange(e.target.files[0])}
            />
            <Form.Text muted>
                You can optionally upload a dataset containing comma or tab separated text and labels.
            </Form.Text>
        </Form.Group>
        <Form.Group className="mb-3">
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
        <Form.Group>
            <Form.Floating>
                <Form.Control
                    id="model-description"
                    as="textarea"
                    placeholder="Enter a description..."
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    style={{ height: "100px" }}
                />
                <Form.Label htmlFor="model-description">Description</Form.Label>
            </Form.Floating>
        </Form.Group>
    </FormModal>
);

export default ModelFormModal;
