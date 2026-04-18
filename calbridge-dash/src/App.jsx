import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DateRangeProvider } from './context/DateRangeContext';
import { UserProvider } from './context/UserContext';
import { AdvertiserProvider } from './context/AdvertiserContext';
import { MarketplaceProvider } from './context/MarketplaceContext';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import VendorPerformance from './pages/VendorPerformance';
import Inventory from './pages/Inventory';
import Advertising from './pages/Advertising';
import AdvertisingCampaigns from './pages/advertising/AdvertisingCampaigns';
import AdvertisingKeywords from './pages/advertising/AdvertisingKeywords';
import AdvertisingProducts from './pages/advertising/AdvertisingProducts';
import AdvertisingTargeting from './pages/advertising/AdvertisingTargeting';
import AdvertisingDsp from './pages/advertising/AdvertisingDsp';
import Forecasting from './pages/Forecasting';
import Account from './pages/Account';
import Cogs from './pages/Cogs';
import Recommendations from './pages/Recommendations';
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
      <AdvertiserProvider>
      <MarketplaceProvider>
      <BrowserRouter basename="/analytics">
        <Layout>
          <Routes>
            <Route path="/"            element={<Overview />} />
            <Route path="/vendor"      element={<VendorPerformance />} />
            <Route path="/inventory"   element={<Inventory />} />
            <Route path="/advertising" element={<Advertising />} />
            <Route path="/advertising/campaigns" element={<AdvertisingCampaigns />} />
            <Route path="/advertising/keywords"  element={<AdvertisingKeywords />} />
            <Route path="/advertising/products"  element={<AdvertisingProducts />} />
            <Route path="/advertising/targeting" element={<AdvertisingTargeting />} />
            <Route path="/advertising/dsp"       element={<AdvertisingDsp />} />
            <Route path="/forecasting" element={<Forecasting />} />
            <Route path="/account"     element={<Account />} />
            <Route path="/cogs"        element={<Cogs />} />
            <Route path="/pacing"          element={<Pacing />} />
            <Route path="/recommendations" element={<Recommendations />} />
          </Routes>
        </Layout>
      </BrowserRouter>
      </MarketplaceProvider>
      </AdvertiserProvider>
      </UserProvider>
      </DateRangeProvider>
    </QueryClientProvider>
  );
}
