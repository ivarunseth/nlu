import { createContext, useState, useContext, useEffect } from "react";
import { useParams } from "react-router-dom";
import { UserContext } from "./UserContext";
import { useApi } from "./ApiContext";

export const ModelContext = createContext();

export const ModelProvider = ({ children }) => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);
    const api = useApi();
    const [model, setModel] = useState(null);

    useEffect(() => {
        if (user && modelId) {
            const getModel = async () => {
                try {
                    setModel(await api.models.get(modelId));
                } catch (error) {
                    console.error(error.response.data.error);
                }
            };
            getModel();
        }
    }, [api, user, modelId])

    return (
        <ModelContext.Provider value={{ model, setModel }}>
            {children}
        </ModelContext.Provider>
    );

};