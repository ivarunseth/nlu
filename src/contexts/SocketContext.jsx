import React, { createContext, useContext, useEffect, useRef } from 'react'

import io from 'socket.io-client'
import { UserContext } from './UserContext'

export const SocketContext = createContext()

export const SocketProvider = ({ children }) => {
    
    const socket = useRef(null);

    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    )
}

export const useSocket = () => {

    const { socket } = useContext(SocketContext);
    const { user } = useContext(UserContext);

    useEffect(() => {
        if (user) {

            if (!socket.current) {
                // Connect to the page's own origin; the Vite proxy forwards
                // /socket.io to the environment's control-plane server.
                socket.current = io({
                    transports: ['websocket'],
                    auth: {
                        token: user.token
                    }
                });
            }

            socket.current.on('connect', () => {
                console.info(`Successfully connected to socket`);
            });

            socket.current.on('disconnect', () => {
                console.info(`Successfully disconnected from socket`);
            });

            socket.current.on('error', error => {
                console.error('error in socket connection:', error.message);
            });

            return () => {
                if (socket.current && socket.current.connected) {
                    socket.current.disconnect();
                    socket.current = null
                }
            };
        }
    }, [user, socket])

    return socket.current;
};
