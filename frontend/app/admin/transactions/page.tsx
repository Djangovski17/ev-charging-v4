"use client";

import { useState, useEffect } from "react";
import axios from "axios";

interface Transaction {
  id: string;
  stripePaymentId: string;
  stationId: string;
  connectorId: string | null;
  station: {
    id: string;
    name: string;
    connectorType: string;
  };
  connector: {
    id: string;
    type: string;
    powerKw: number;
  } | null;
  amount: number;
  finalCost: number | null;
  energyKwh: number;
  startTime: string;
  endTime: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const statusUpper = status.toUpperCase();
  
  if (statusUpper === "COMPLETED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Zakończona
      </span>
    );
  } else if (statusUpper === "CHARGING" || statusUpper === "ACTIVE" || statusUpper === "PENDING") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        W Trakcie
      </span>
    );
  } else if (statusUpper === "FAULTED" || statusUpper === "FAILED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        Błąd
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
      {status}
    </span>
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/transactions`);
      setTransactions(response.data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Transakcje</h1>
      {isLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
          <p className="mt-4 text-slate-600">Ładowanie transakcji...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p>Brak transakcji w bazie danych.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    ID (Stripe)
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Stacja
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Złącze
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Kwota
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    kWh
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {transactions.map((transaction) => {
                  // Użyj finalCost jeśli dostępne, w przeciwnym razie amount
                  const displayCost = transaction.finalCost !== null && transaction.finalCost !== undefined
                    ? transaction.finalCost
                    : transaction.amount;
                  
                  return (
                    <tr key={transaction.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                        {transaction.stripePaymentId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.station.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.connector ? (
                          <span>
                            {transaction.connector.type} ({transaction.connector.powerKw} kW)
                          </span>
                        ) : transaction.connectorId ? (
                          <span>Złącze #{transaction.connectorId}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {displayCost.toFixed(2)} zł
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.energyKwh.toFixed(2)} kWh
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        <StatusBadge status={transaction.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {formatDate(transaction.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

