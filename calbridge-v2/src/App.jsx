import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DateRangeProvider } from './context/DateRangeContext';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Retail from './pages/Retail';
import Advertising from './pages/Advertising';
import Opportunities from './pages/Opportunities';
import Actions from './pages/Actions';
import DataExplorer from './pages/DataExplorer';
import Experiments from './pages/Experiments';
import Forecasting from './pages/Forecasting';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 2 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DateRangeProvider>
        <BrowserRouter basename="/v2">
          <Layout>
            <Routes>
              <Route path="/"              element={<Overview />} />
              <Route path="/retail"        element={<Retail />} />
              <Route path="/advertising"   element={<Advertising />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/actions"       element={<Actions />} />
              <Route path="/data"          element={<DataExplorer />} />
              <Route path="/experiments"   element={<Experiments />} />
              <Route path="/forecasting"   element={<Forecasting />} />
              <Route path="/reports"       element={<Reports />} />
              <Route path="/settings"      element={<Settings />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </DateRangeProvider>
    </QueryClientProvider>
  );
}
