import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AppShell } from "./layouts/AppShell";
import { BaselinePage } from "./pages/BaselinePage";
import { CreateIterationPage } from "./pages/CreateIterationPage";
import { IteratePage } from "./pages/IteratePage";
import { LockedPromptDetail } from "./pages/LockedPromptDetail";
import { LockedPromptsLibrary } from "./pages/LockedPromptsLibrary";
import { PostTestPage } from "./pages/PostTestPage";
import { ProgramsPage } from "./pages/ProgramsPage";
import { ProjectHistoryPage } from "./pages/ProjectHistoryPage";
import { ProjectsDashboard } from "./pages/ProjectsDashboard";
import { SetupPage } from "./pages/SetupPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/projects" element={<ProjectsDashboard />} />
        <Route path="/projects/:projectId/setup" element={<SetupPage />} />
        <Route path="/projects/:projectId/baseline" element={<BaselinePage />} />
        <Route path="/projects/:projectId/iterate" element={<IteratePage />} />
        <Route path="/projects/:projectId/iterate/new" element={<CreateIterationPage />} />
        <Route path="/projects/:projectId/test" element={<PostTestPage />} />
        <Route path="/projects/:projectId/history" element={<ProjectHistoryPage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/locked-prompts" element={<LockedPromptsLibrary />} />
        <Route path="/locked-prompts/:lockedId" element={<LockedPromptDetail />} />
      </Route>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}
