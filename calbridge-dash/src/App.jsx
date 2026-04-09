import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DateRangeProvider } from './context/DateRangeContext';
import { UserProvider } from './context/UserContext';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import VendorPerformance from './pages/VendorPerformance';
import Inventory from './pages/Inventory';
import Advertising from './pages/Advertising';
import Forecasting from './pages/Forecasting';
import Account from './pages/Account';
import Cogs from './pages/Cogs';
import Pacing from './pages/Pacing';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DateRangeProvider>
      <UserProvider>
      <BrowserRouter basename="/analytics">
        <Layout>
          <Routes>
            <Route path="/"            element={<Overview />} />
            <Route path="/vendor"      element={<VendorPerformance />} />
            <Route path="/inventory"   element={<Inventory />} />
            <Route path="/advertising" element={<Advertising />} />
            <Route path="/forecasting" element={<Forecasting />} />
            <Route path="/account"     element={<Account />} />
            <Route path="/cogs"        element={<Cogs />} />
            <Route path="/pacing"      element={<Pacing />} />
          </Routes>
        </Layout>
      </BrowserRouter>
      </UserProvider>
      </DateRangeProvider>
    </QueryClientProvider>
  );
}
