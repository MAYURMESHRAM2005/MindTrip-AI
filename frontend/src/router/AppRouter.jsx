import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import AuthLayout from '../components/layout/AuthLayout';
import { useAuthStore } from '../store/authStore';
import { PageLoader } from '../components/ui/Spinner';

// Public
import Landing from '../pages/Landing';
import Login from '../pages/Login';
import Register from '../pages/Register';
import ForgotPassword from '../pages/ForgotPassword';
import ResetPassword from '../pages/ResetPassword';
import VerifyEmail from '../pages/VerifyEmail';

// Authenticated
import Dashboard from '../pages/Dashboard';
import Agents from '../pages/Agents';
import TripPlanner from '../pages/TripPlanner';
import ItineraryPage from '../pages/ItineraryPage';
import BudgetOptimizer from '../pages/BudgetOptimizer';
import Flights from '../pages/Flights';
import Trains from '../pages/Trains';
import Buses from '../pages/Buses';
import Hotels from '../pages/Hotels';
import Restaurants from '../pages/Restaurants';
import Maps from '../pages/Maps';
import Weather from '../pages/Weather';
import VoiceAssistant from '../pages/VoiceAssistant';
import ImageSearch from '../pages/ImageSearch';
import Chatbot from '../pages/Chatbot';
import Expenses from '../pages/Expenses';
import OfflineItinerary from '../pages/OfflineItinerary';
import Emergency from '../pages/Emergency';
import QRTickets from '../pages/QRTickets';
import SavedTrips from '../pages/SavedTrips';
import Notifications from '../pages/Notifications';
import Profile from '../pages/Profile';
import Settings from '../pages/Settings';
import Admin from '../pages/Admin';
import NotFound from '../pages/NotFound';

function RequireAuth({ children }) {
  const { authenticated, initializing } = useAuthStore();
  if (initializing) return <PageLoader label="Restoring your session…" />;
  if (!authenticated) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/verify-email/:token" element={<VerifyEmail />} />
      </Route>

      <Route
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/planner" element={<TripPlanner />} />
        <Route path="/itinerary" element={<ItineraryPage />} />
        <Route path="/itinerary/:id" element={<ItineraryPage />} />
        <Route path="/budget" element={<BudgetOptimizer />} />
        <Route path="/flights" element={<Flights />} />
        <Route path="/trains" element={<Trains />} />
        <Route path="/buses" element={<Buses />} />
        <Route path="/hotels" element={<Hotels />} />
        <Route path="/restaurants" element={<Restaurants />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/weather" element={<Weather />} />
        <Route path="/voice" element={<VoiceAssistant />} />
        <Route path="/image-search" element={<ImageSearch />} />
        <Route path="/chat" element={<Chatbot />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/offline" element={<OfflineItinerary />} />
        <Route path="/emergency" element={<Emergency />} />
        <Route path="/qr-wallet" element={<QRTickets />} />
        <Route path="/saved-trips" element={<SavedTrips />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
