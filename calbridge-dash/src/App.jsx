import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h2 style={{ color: '#b91c1c' }}>⚠️ App Error</h2>
          <p style={{ color: '#374151' }}>Something crashed. Error details:</p>
          <pre style={{ background: '#fee2e2', padding: '16px', borderRadius: '8px', overflow: 'auto', fontSize: '13px' }}>
            {this.state.error.toString()}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '16px', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DateRangeProvider } from './context/DateRangeContext';
import { UserProvider } from './context/UserContext';
import { AdvertiserProvider } from './context/AdvertiserContext';
import { MarketplaceProvider } from './context/MarketplaceContext';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import VendorPerformance  from './pages/VendorPerformance';
import SellerPerformance from './pages/SellerPerformance';
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
import Pricing from './pages/Pricing';
import Signup from './pages/Signup';
import Brands from './pages/Brands';

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
    <ErrorBoundary>
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
            <Route path="/seller"      element={<SellerPerformance />} />
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
            <Route path="/pricing"         element={<Pricing />} />
            <Route path="/signup"          element={<Signup />} />
            <Route path="/brands"          element={<Brands />} />
          </Routes>
        </Layout>
      </BrowserRouter>
      </MarketplaceProvider>
      </AdvertiserProvider>
      </UserProvider>
      </DateRangeProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
