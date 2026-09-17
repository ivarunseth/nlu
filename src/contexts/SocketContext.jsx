import { createContext, useContext, useEffect, useState } from 'react'

import io from 'socket.io-client'
import { UserContext } from './UserContext'

// One Socket.IO connection per signed-in session, owned here so it outlives
// any page: it opens when a user appears and closes on sign-out, and every
// consumer reads the same instance through useSocket(). (It used to be opened
// and torn down by whichever page called the hook, so leaving that page
// disconnected everyone else — including the app-wide training strip.)
//
// Rooms are per socket and do not survive a reconnect, so subscribers re-join
// on every "connect" and unsubscribe with "leave" when they are done.
export const SocketContext = createContext({ socket: null })

export const SocketProvider = ({ children }) => {
    const { user } = useContext(UserContext);
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        if (!user) return undefined;

        // Connect to the page's own origin; the Vite proxy (or nginx)
        // forwards /socket.io to the events blueprint.
        const connection = io({
            transports: ['websocket'],
            auth: {
                token: user.token
            }
        });
        connection.on('connect', () => {
            console.info('Successfully connected to socket');
        });
        connection.on('disconnect', () => {
            console.info('Successfully disconnected from socket');
        });
        connection.on('error', (error) => {
            console.error('error in socket connection:', error.message);
        });
        setSocket(connection);

        return () => {
            connection.disconnect();
            setSocket(null);
        };
    }, [user]);

    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    )
}

// The shared connection, or null until the session's socket is up (or after
// sign-out). Callers guard on it and list it as an effect dependency, so
// their subscriptions attach as soon as it exists.
export const useSocket = () => useContext(SocketContext).socket;
