"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

interface Stats {
  totalConnectors: number;
  statusCounts: {
    available: number;
    charging: number;
    faulted: number;
  };
  totalRevenue: number;
  totalEnergy: number;
  totalSessions: number;
  avgCost: number;
  avgKwh: number;
  avgDuration: number;
}

function StatCard({
  title,
  value,
  unit,
  icon,
  color = "slate",
  isLoading = false,
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
  color?: "green" | "blue" | "red" | "slate";
  isLoading?: boolean;
}) {
  const colorClasses = {
    green: "text-green-600",
    blue: "text-blue-600",
    red: "text-red-600",
    slate: "text-slate-600",
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-slate-600">{title}</p>
        <div className={colorClasses[color]}>{icon}</div>
      </div>
      {isLoading ? (
        <div className="h-8 w-24 bg-slate-200 rounded animate-pulse"></div>
      ) : (
        <p className="text-3xl font-bold text-slate-900">
          {typeof value === "number" ? value.toLocaleString("pl-PL") : value}
          {unit && <span className="text-xl font-normal text-slate-600 ml-1">{unit}</span>}
        </p>
      )}
    </div>
  );
}

function SmallStatCard({
  title,
  value,
  unit,
  isLoading = false,
}: {
  title: string;
  value: string | number;
  unit?: string;
  isLoading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-600 mb-2">{title}</p>
      {isLoading ? (
        <div className="h-6 w-20 bg-slate-200 rounded animate-pulse"></div>
      ) : (
        <p className="text-xl font-bold text-slate-900">
          {typeof value === "number" ? value.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}
          {unit && <span className="text-sm font-normal text-slate-600 ml-1">{unit}</span>}
        </p>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  // Ustaw domyślne daty na dzisiaj
  useEffect(() => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    setStartDate(todayStr);
    setEndDate(todayStr);
  }, []);

  // Sprawdź autentykację
  useEffect(() => {
    const auth = localStorage.getItem("admin_authenticated");
    if (auth !== "true") {
      router.push("/admin");
    } else {
      setIsAuthenticated(true);
    }
  }, [router]);

  // Pobierz statystyki przy zmianie dat
  useEffect(() => {
    if (isAuthenticated && startDate && endDate) {
      fetchStats();
    }
  }, [isAuthenticated, startDate, endDate]);

  const fetchStats = async () => {
    setIsLoadingStats(true);
    try {
      const params = new URLSearchParams({
        startDate: startDate,
        endDate: endDate,
      });
      const response = await axios.get(`${API_URL}/admin/stats?${params.toString()}`);
      setStats(response.data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
          <p className="mt-4 text-slate-600">Ładowanie...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Górna belka z nagłówkiem i DatePicker */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-3xl font-bold text-slate-900">Pulpit</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="startDate" className="text-sm font-medium text-slate-700">
              Od:
            </label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="endDate" className="text-sm font-medium text-slate-700">
              Do:
            </label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Sekcja 1: Status Infrastruktury */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Status Infrastruktury</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="Dostępne"
            value={stats?.statusCounts.available ?? 0}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            color="green"
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Ładowanie"
            value={stats?.statusCounts.charging ?? 0}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            color="blue"
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Awaria"
            value={stats?.statusCounts.faulted ?? 0}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            color="red"
            isLoading={isLoadingStats}
          />
        </div>
      </div>

      {/* Sekcja 2: Wyniki Finansowe */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Wyniki Finansowe</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="Przychód"
            value={stats?.totalRevenue ?? 0}
            unit="PLN"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            color="slate"
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Sprzedana Energia"
            value={stats?.totalEnergy ?? 0}
            unit="kWh"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            color="slate"
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Liczba Sesji"
            value={stats?.totalSessions ?? 0}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
            color="slate"
            isLoading={isLoadingStats}
          />
        </div>
      </div>

      {/* Sekcja 3: Efektywność */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Efektywność</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SmallStatCard
            title="Średni Koszt"
            value={stats?.avgCost ?? 0}
            unit="PLN"
            isLoading={isLoadingStats}
          />
          <SmallStatCard
            title="Średnia kWh"
            value={stats?.avgKwh ?? 0}
            unit="kWh"
            isLoading={isLoadingStats}
          />
          <SmallStatCard
            title="Średni Czas Ładowania"
            value={stats?.avgDuration ?? 0}
            unit="min"
            isLoading={isLoadingStats}
          />
        </div>
      </div>
    </>
  );
}
