"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ChartDataPoint {
  date: string;
  revenue: number;
  energy: number;
  sessions: number;
}

interface Stats {
  totalConnectors: number;
  statusCounts: {
    available: number;
    charging: number;
    faulted: number;
    total: number;
  };
  totalRevenue: number;
  totalEnergy: number;
  totalSessions: number;
  avgCost: number;
  avgKwh: number;
  avgDuration: number;
  chartData: ChartDataPoint[];
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

type ChartDataType = "revenue" | "energy" | "sessions";
type TimeRange = "week" | "month" | "30days";

export default function AdminDashboard() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [chartDataType, setChartDataType] = useState<ChartDataType>("revenue");
  const [timeRange, setTimeRange] = useState<TimeRange>("week");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  // Funkcja do formatowania daty po polsku
  const getFormattedDate = () => {
    const today = new Date();
    const days = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
    const months = [
      "Stycznia", "Lutego", "Marca", "Kwietnia", "Maja", "Czerwca",
      "Lipca", "Sierpnia", "Września", "Października", "Listopada", "Grudnia"
    ];
    return `${days[today.getDay()]}, ${today.getDate()} ${months[today.getMonth()]}`;
  };

  // Ustaw domyślne daty na podstawie zakresu czasu
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let start: Date;
    if (timeRange === "week") {
      // Ten tydzień (od poniedziałku)
      start = new Date(today);
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Ustaw na poniedziałek
      start.setDate(diff);
    } else if (timeRange === "month") {
      // Ten miesiąc
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      // Ostatnie 30 dni
      start = new Date(today);
      start.setDate(start.getDate() - 29);
    }
    
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(today.toISOString().split("T")[0]);
  }, [timeRange]);

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
        <div className="mb-2">
          <h2 className="text-xl font-semibold text-slate-900">Status Infrastruktury</h2>
          <p className="text-sm text-slate-600 mt-1">{getFormattedDate()}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="Dostępne"
            value={`${stats?.statusCounts.available ?? 0} / ${stats?.statusCounts.total ?? 0}`}
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

      {/* Sekcja 2: Wyniki Finansowe - Wykres */}
      <div className="mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          {/* Nagłówek z tytułem, tabs i dropdown */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
            <h2 className="text-xl font-semibold text-slate-900">Raport Sprzedaży</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Tabs */}
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setChartDataType("revenue")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    chartDataType === "revenue"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Przychody
                </button>
                <button
                  onClick={() => setChartDataType("energy")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    chartDataType === "energy"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Sprzedana Energia
                </button>
                <button
                  onClick={() => setChartDataType("sessions")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    chartDataType === "sessions"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Liczba Sesji
                </button>
              </div>
              {/* Dropdown zakresu czasu */}
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setTimeRange("week")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    timeRange === "week"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Ten Tydzień
                </button>
                <button
                  onClick={() => setTimeRange("30days")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    timeRange === "30days"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Ostatnie 30 Dni
                </button>
                <button
                  onClick={() => setTimeRange("month")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    timeRange === "month"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Ten Miesiąc
                </button>
              </div>
            </div>
          </div>

          {/* Wykres */}
          {isLoadingStats ? (
            <div className="h-96 flex items-center justify-center">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
                <p className="mt-4 text-slate-600">Ładowanie danych...</p>
              </div>
            </div>
          ) : stats?.chartData && stats.chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getDate()}.${date.getMonth() + 1}`;
                  }}
                />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  tickFormatter={(value) => {
                    if (chartDataType === "revenue") {
                      return `${value} PLN`;
                    } else if (chartDataType === "energy") {
                      return `${value} kWh`;
                    }
                    return value.toString();
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "8px 12px",
                  }}
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString("pl-PL", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    });
                  }}
                  formatter={(value: number) => {
                    if (chartDataType === "revenue") {
                      return [`${value.toFixed(2)} PLN`, "Przychód"];
                    } else if (chartDataType === "energy") {
                      return [`${value.toFixed(2)} kWh`, "Energia"];
                    }
                    return [value.toString(), "Sesje"];
                  }}
                />
                <Bar
                  dataKey={chartDataType}
                  radius={[8, 8, 0, 0]}
                >
                  {stats.chartData.map((entry, index) => {
                    const today = new Date().toISOString().split("T")[0];
                    const isToday = entry.date === today;
                    return (
                      <Cell
                        key={`cell-${index}`}
                        fill={isToday ? "#3b82f6" : "#64748b"}
                        opacity={isToday ? 1 : 0.7}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-slate-500">
              <p>Brak danych do wyświetlenia</p>
            </div>
          )}
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
