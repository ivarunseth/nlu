import { createContext, useState, useContext, useEffect } from "react";
import { useParams } from "react-router-dom";
import { UserContext } from "./UserContext";
import axios from "axios";

export const ModelContext = createContext();

export const ModelProvider = ({ children }) => {

    const { modelId } = useParams();

    const { user } = useContext(UserContext);
    const [model, setModel] = useState(null);

    useEffect(() => {
        if (user && modelId) {
            const getModel = async () => {
                try {
                    const response = await axios.get(
                        `/api/models/${modelId}`,
                        {
                            headers: {
                                'Authorization': `Bearer ${user.token}`
                            }
                        }
                    );
                    setModel(response.data);
                } catch (error) {
                    console.error(error.response.data.error);
                }
            };
            getModel();
        }
    }, [user, modelId])

    return (
        <ModelContext.Provider value={{ model, setModel }}>
            {children}
        </ModelContext.Provider>
    );

};