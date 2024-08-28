import { createContext, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
    
    const [user, setUser] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const storedUser = JSON.parse(localStorage.getItem("user"));
        if (!user && !storedUser && location.pathname !== '/signup') {
            navigate('/signin');
        } else if (!user && storedUser) {
            setUser(storedUser);
            navigate('/');
        }
    }, [user, navigate, location.pathname]);

    const signUp = async (email, password) => {
        let data = new FormData();
        data.append('email', email);
        data.append('password', password);
        navigate('/signin', { 
            state: {
                alert: {
                    variant: "success", 
                    message: "You have successfully signed up. Welcome aboard!"
                }
            }
        });
    };

    const signIn = async (email, password) => {
        if (!user) {
            const response = await axios.post('/api/tokens', {}, {auth: {username: email, password: password}});
            setUser(response.data);
            localStorage.setItem("user", JSON.stringify(response.data));
            navigate("/");
        }
    }

    const signOut = async () => {
        if (user) {
            axios.delete('/api/tokens', {headers: {Authorization : `Bearer ${user.token}`}});
            localStorage.removeItem("user");
            setUser(null);
            navigate("/signin");
        }
    };

    return (
        <UserContext.Provider value={{ user, setUser, signUp, signIn, signOut }}>
            {children}
        </UserContext.Provider>
    );
};