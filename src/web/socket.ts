import { io, type Socket } from 'socket.io-client';

export function connectSocket(): Socket {
  return io({ path: '/socket.io', withCredentials: true });
}
