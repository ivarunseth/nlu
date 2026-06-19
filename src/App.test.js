import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the sign-in form for anonymous users', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
