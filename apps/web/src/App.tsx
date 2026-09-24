import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ApiKeys } from "./pages/ApiKeys";
import { Dashboard } from "./pages/Dashboard";
import { Docs } from "./pages/Docs";
import { Login } from "./pages/Login";
import { ServiceDetail } from "./pages/ServiceDetail";
import { ServiceEditor } from "./pages/ServiceEditor";
import { Services } from "./pages/Services";

export function App() {
  return <Layout><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/services" element={<Services />} />
    <Route path="/services/new" element={<ServiceEditor />} />
    <Route path="/services/:id" element={<ServiceDetail />} />
    <Route path="/services/:id/edit" element={<ServiceEditor />} />
    <Route path="/api-keys" element={<ApiKeys />} />
    <Route path="/docs" element={<Docs />} />
    <Route path="/login" element={<Login />} />
  </Routes></Layout>;
}
