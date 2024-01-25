import { createContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) {
            const storedUser = JSON.parse(localStorage.getItem("user"));
            if (storedUser) {
                setUser(storedUser);
                navigate('/');
            } else {
                navigate('/signin');
            }
        }
    }, [user, navigate]);

    const signIn = async (email, password) => {
        if (!user) {
            await axios.post('/api/tokens',
                {},
                {
                    auth: {
                        username: email,
                        password: password
                    }
                }
            ).then(response => {
                setUser(response.data)
                localStorage.setItem("user", JSON.stringify(response.data));
                navigate("/");
            })
        }
    }

    const signOut = async () => {
        if (user) {
            await axios.delete('/api/tokens', {
                headers: { 
                    Authorization : `Bearer ${user.token}` 
                }
            }).then(response => {
                if (response.status === 204) {
                    localStorage.removeItem("user");
                    setUser(null);
                    navigate("/signin");
                }
            });
        }
    };

    return (
        <UserContext.Provider value={{ user, setUser, signIn, signOut }}>
            {children}
        </UserContext.Provider>
    );
};