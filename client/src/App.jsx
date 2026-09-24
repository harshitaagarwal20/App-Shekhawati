import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <UpdateBanner />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
