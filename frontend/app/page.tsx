"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import axios from "axios";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Zap, Plug, BatteryCharging, Info, Wallet, Clock, CheckCircle2, AlertCircle, ArrowLeft, CreditCard, MapPin, Navigation, Map, Filter, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";

// --- KONFIGURACJA ---
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const STRIPE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = loadStripe(STRIPE_KEY);

type ViewState = "idle" | "payment" | "charging" | "summary";

// Typ dla stacji z API
type Station = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  pricePerKwh: number;
  status: "Available" | "Busy";
  distance?: number; // Dystans w km (dodawany po obliczeniu)
  availableCount?: number; // Liczba dostępnych złączy (obliczona przez backend)
  connectors?: Array<{
    id: string;
    type: string;
    powerKw: number;
    status: string;
  }>;
};

// --- HOOK DO OPÓŹNIENIA (Debounce) ---
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

// --- KOMPONENT PŁATNOŚCI STRIPE ---
const CheckoutForm = ({ amount, onSuccess, onCancel, stationName }: { amount: number, onSuccess: () => void, onCancel: () => void, stationName?: string }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message || "Wystąpił błąd płatności");
      setProcessing(false);
    } else if (result.paymentIntent && result.paymentIntent.status === "succeeded") {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 mt-4">
      {/* Nagłówek z nazwą stacji */}
      {stationName && (
        <div className="text-center pb-2">
          <p className="text-sm text-slate-500 font-medium mb-1">Stacja</p>
          <p className="text-lg font-bold text-slate-900">{stationName}</p>
        </div>
      )}
      
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm min-h-[200px]">
        {/* To jest miejsce, gdzie Stripe wstrzykuje swój formularz */}
        <PaymentElement id="payment-element" options={{ layout: "tabs" }} />
      </div>
      
      {error && (
        <div className="p-3 bg-rose-50 text-rose-600 text-sm rounded-lg flex items-center gap-2 border border-rose-100">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* PRZYCISKI AKCJI */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="w-full py-4 px-4 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
        >
          Anuluj
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="w-full py-4 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 flex justify-center items-center gap-2"
        >
          {processing ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Przetwarzanie
            </span>
          ) : (
            <>
              <Zap size={20} fill="currentColor" />
              Zapłać {amount} zł
            </>
          )}
        </button>
      </div>
    </form>
  );
};

// --- FUNKCJA HAVERSINE (obliczanie dystansu) ---
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Promień Ziemi w km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Dystans w km
}

// --- GŁÓWNA ZAWARTOŚĆ ---
function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const stationId = searchParams.get("station");
  
  // Stany
  const [isLoading, setIsLoading] = useState(true);
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(50);
  const [clientSecret, setClientSecret] = useState("");
  const [isInitializingPayment, setIsInitializingPayment] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  
  const debouncedAmount = useDebounce(amount, 800);
  
  const [energyKwh, setEnergyKwh] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [lastSessionCost, setLastSessionCost] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0);
  const [invoiceEmail, setInvoiceEmail] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [stationAddress, setStationAddress] = useState<string | null>(null);
  const [stationCity, setStationCity] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [pricePerKwh, setPricePerKwh] = useState<number>(2.50);
  const [connectors, setConnectors] = useState<Array<{
    id: string;
    name: string;
    type: string;
    power: string;
    status: string;
    pricePerKwh: number;
    icon: typeof Plug | typeof Zap | typeof BatteryCharging;
  }>>([]);

  // Stany dla widoku wyboru stacji
  const [stations, setStations] = useState<Station[]>([]);
  const [allStations, setAllStations] = useState<Station[]>([]); // Wszystkie stacje (przed filtrowaniem)
  const [isLoadingStations, setIsLoadingStations] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  
  // Stany dla filtrów
  const [showFilters, setShowFilters] = useState(false);
  const [priceSort, setPriceSort] = useState<"asc" | "desc" | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "available">("all");
  const [locationSort, setLocationSort] = useState(false); // Czy sortować po lokalizacji (najbliższe)

  const PRICE_PER_KWH = pricePerKwh;

  // Mapowanie ikon dla złączy (na podstawie typu)
  const getConnectorIcon = (type: string): typeof Plug | typeof Zap | typeof BatteryCharging => {
    if (type.includes('CCS')) return Zap;
    if (type.includes('CHAdeMO')) return BatteryCharging;
    return Plug; // Type 2 i domyślnie
  };

  // Mapowanie statusu na tekst wyświetlany
  const getStatusText = (status: string): string => {
    switch (status) {
      case 'CHARGING':
        return 'Zajęte';
      case 'OCCUPIED':
        return 'Zajęte';
      case 'FAULTED':
        return 'Awaria';
      case 'AVAILABLE':
        return 'Wolne';
      default:
        return status;
    }
  };

  const selectedConnectorData = connectors.find(c => c.id === connectorId);

  // --- LOGIKA ---

  // Pobierz dane stacji (address, city, connectors) przy mount
  useEffect(() => {
    if (stationId) {
      const fetchStationData = async () => {
        try {
          const response = await axios.get(`${API_URL}/station/${stationId}`);
          if (response.data.success && response.data.station) {
            setStationName(response.data.station.name || null);
            setStationAddress(response.data.station.address || null);
            setStationCity(response.data.station.city || null);
            setPricePerKwh(response.data.station.pricePerKwh || 2.50);
            
            // Pobierz złącza z backendu i dodaj ikony
            // WYMUSZENIE: Tylko dane z API, bez mocków
            if (response.data.station.connectors && Array.isArray(response.data.station.connectors)) {
              const connectorsWithIcons = response.data.station.connectors.map((connector: {
                id: string;
                name: string;
                type: string;
                power: string;
                status: string;
                pricePerKwh?: number;
              }) => ({
                id: connector.id,
                name: connector.name,
                type: connector.type,
                power: connector.power, // Backend już zwraca w formacie 'X kW'
                status: connector.status,
                pricePerKwh: connector.pricePerKwh || pricePerKwh, // Użyj ceny złącza lub stacji jako fallback
                icon: getConnectorIcon(connector.type),
              }));
              setConnectors(connectorsWithIcons);
            } else {
              // Jeśli backend nie zwraca złączy, ustaw pustą tablicę (BEZ MOCKÓW)
              setConnectors([]);
            }
          }
        } catch (err) {
          console.error("Błąd pobierania danych stacji:", err);
        }
      };
      fetchStationData();
    }
  }, [stationId]);

  // Pobierz listę stacji (gdy brak stationId)
  useEffect(() => {
    if (!stationId) {
      let isFirstLoad = true;
      
      const fetchStations = async (isPolling = false) => {
        // Tylko przy pierwszym ładowaniu pokazuj loading state
        if (!isPolling) {
          setIsLoadingStations(true);
        }
        
        try {
          const response = await axios.get(`${API_URL}/api/stations`);
          if (response.data.success && response.data.stations) {
            let stationsData: Station[] = response.data.stations;

            // Jeśli użytkownik udostępnił lokalizację, oblicz dystans
            if (userLocation) {
              stationsData = stationsData.map(station => {
                if (station.latitude && station.longitude) {
                  const distance = calculateDistance(
                    userLocation.lat,
                    userLocation.lon,
                    station.latitude,
                    station.longitude
                  );
                  return { ...station, distance };
                }
                return station;
              });
            }

            // Aktualizuj stan TYLKO jeśli dane się zmieniły (porównaj po ID i availableCount)
            setAllStations(prevStations => {
              // Sprawdź czy dane faktycznie się zmieniły
              const hasChanges = prevStations.length !== stationsData.length ||
                prevStations.some((prev, index) => {
                  const current = stationsData[index];
                  return !current || 
                    prev.id !== current.id || 
                    prev.availableCount !== current.availableCount ||
                    prev.status !== current.status;
                });
              
              // Aktualizuj tylko jeśli są zmiany
              return hasChanges ? stationsData : prevStations;
            });
          }
        } catch (err) {
          console.error("Błąd pobierania stacji:", err);
        } finally {
          // Tylko przy pierwszym ładowaniu ukryj loading state
          if (!isPolling) {
            setIsLoadingStations(false);
          }
          isFirstLoad = false;
        }
      };
      
      // Pobierz od razu (pierwsze ładowanie)
      fetchStations(false);
      
      // Dodaj polling - odświeżaj listę stacji co 5 sekund (bez pokazywania loading state)
      const pollingInterval = setInterval(() => {
        fetchStations(true); // true = to jest polling, nie pokazuj loading
      }, 5000); // 5 sekund
      
      return () => {
        clearInterval(pollingInterval);
      };
    }
  }, [stationId, userLocation]);

  // Efekt do filtrowania i sortowania stacji
  useEffect(() => {
    if (!stationId && allStations.length > 0) {
      let filteredStations = [...allStations];

      // Filtrowanie po statusie
      if (statusFilter === "available") {
        filteredStations = filteredStations.filter(s => s.status === "Available");
      }

      // Sortowanie po cenie
      if (priceSort === "asc") {
        filteredStations.sort((a, b) => a.pricePerKwh - b.pricePerKwh);
      } else if (priceSort === "desc") {
        filteredStations.sort((a, b) => b.pricePerKwh - a.pricePerKwh);
      }

      // Sortowanie po lokalizacji (najbliższe)
      if (locationSort && userLocation) {
        // Upewnij się, że dystans jest obliczony dla wszystkich stacji
        filteredStations = filteredStations.map(station => {
          if (station.latitude && station.longitude && station.distance === undefined) {
            const distance = calculateDistance(
              userLocation.lat,
              userLocation.lon,
              station.latitude,
              station.longitude
            );
            return { ...station, distance };
          }
          return station;
        });

        filteredStations.sort((a, b) => {
          if (a.distance !== undefined && b.distance !== undefined) {
            return a.distance - b.distance;
          }
          if (a.distance !== undefined) return -1;
          if (b.distance !== undefined) return 1;
          return 0;
        });
      } else if (!priceSort && !locationSort) {
        // Domyślne sortowanie alfabetyczne
        filteredStations.sort((a, b) => {
          const cityA = a.city || '';
          const cityB = b.city || '';
          if (cityA !== cityB) {
            return cityA.localeCompare(cityB);
          }
          return a.name.localeCompare(b.name);
        });
      }

      setStations(filteredStations);
    }
  }, [stationId, allStations, priceSort, statusFilter, locationSort, userLocation]);

  // Funkcja do pobrania lokalizacji użytkownika
  const handleRequestLocation = () => {
    setIsRequestingLocation(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError("Twoja przeglądarka nie obsługuje geolokacji");
      setIsRequestingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setIsRequestingLocation(false);
      },
      (error) => {
        console.error("Błąd geolokacji:", error);
        setLocationError("Nie udało się pobrać lokalizacji. Sprawdź uprawnienia przeglądarki.");
        setIsRequestingLocation(false);
      }
    );
  };

  // Funkcja do przejścia do widoku stacji
  const handleSelectStation = (stationId: string) => {
    router.push(`/?station=${stationId}`);
  };

  // Funkcja do usunięcia parametru station z URL (powrót do widoku wyboru)
  const handleBackToStationSelection = () => {
    router.push('/');
  };

  // Funkcja do otwierania nawigacji Google Maps
  const handleNavigateToStation = (station: Station) => {
    if (station.latitude && station.longitude) {
      const url = `https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}`;
      window.open(url, '_blank');
    }
  };

  // Funkcja do obsługi przycisku Pomoc
  const handleHelpClick = () => {
    alert("Potrzebujesz pomocy?\n\nSkontaktuj się z nami:\n📞 +48 123 456 789\n✉️ pomoc@plugbox.pl");
  };

  // Odzyskiwanie sesji przy mount - sprawdź czy jest aktywna sesja
  useEffect(() => {
    if (stationId) {
      const checkActiveSession = async () => {
        setIsLoading(true);
        try {
          console.log(`[Session Recovery] Sprawdzam aktywną sesję dla stacji: ${stationId}`);
          const response = await axios.get(`${API_URL}/stations/${stationId}/active-session`);
          
          console.log('Session Check:', response.data);
          
          if (response.data.success && response.data.data) {
            const sessionData = response.data.data;
            const sessionTransactionId = sessionData.transactionId;
            const sessionStationId = sessionData.stationId;
            
            // KRYTYCZNY WARUNEK: Sprawdź czy sesja należy do aktualnej stacji
            if (sessionStationId && String(sessionStationId) !== String(stationId)) {
              // Sesja należy do innej stacji - zignoruj ją
              console.log(`[Session Recovery] Sesja należy do innej stacji (${sessionStationId} !== ${stationId}) - ignoruję sesję`);
              setViewState("idle");
              // Opcjonalnie: można tutaj wyświetlić toast/komunikat
              // alert('Masz aktywne ładowanie na innej stacji');
              return;
            }
            
            // Sprawdź, czy sesja należy do tego użytkownika (porównaj z localStorage)
            const storedSessionId = localStorage.getItem('active_session_id');
            
            console.log(`[Session Recovery] Porównanie sesji:`, {
              storedSessionId,
              sessionTransactionId,
              sessionStationId,
              currentStationId: stationId,
              stationMatch: sessionStationId === stationId,
              userMatch: storedSessionId === sessionTransactionId
            });
            
            // TYLKO jeśli ID zgadza się z localStorage I sesja należy do tej stacji - to moja sesja
            if (storedSessionId && storedSessionId === sessionTransactionId && sessionStationId === stationId) {
              console.log(`[Session Recovery] To moja sesja na tej stacji - przełączam na widok charging`);
              
              // Ustaw viewState na charging
              setViewState("charging");
              
              // Zaktualizuj startTime na podstawie danych z backendu
              if (sessionData.startTime) {
                setSessionStartTime(new Date(sessionData.startTime));
              }
              
              // Zaktualizuj amount na podstawie wpłaconej kwoty
              if (sessionData.amount) {
                setAmount(sessionData.amount);
              }
              
              // Ustaw connectorId
              if (sessionData.connectorId) {
                setConnectorId(sessionData.connectorId.toString());
              } else {
                setConnectorId("1");
              }
              
              console.log(`[Session Recovery] Sesja odzyskana - viewState: charging, amount: ${sessionData.amount}, startTime: ${sessionData.startTime}`);
            } else {
              // To nie moja sesja lub sesja z innej stacji - zostań w widoku listy złączy
              console.log(`[Session Recovery] To nie moja sesja lub sesja z innej stacji - zostaję w widoku listy złączy`);
              setViewState("idle");
            }
          } else {
            console.log(`[Session Recovery] Brak aktywnej sesji dla stacji: ${stationId}`);
            // Usuń stary sessionId z localStorage jeśli nie ma aktywnej sesji
            localStorage.removeItem('active_session_id');
          }
        } catch (err: any) {
          // 404 oznacza brak aktywnej sesji - to jest OK
          if (err.response?.status === 404) {
            console.log(`[Session Recovery] Brak aktywnej sesji (404)`);
            // Usuń stary sessionId z localStorage
            localStorage.removeItem('active_session_id');
          } else {
            console.error("[Session Recovery] Błąd sprawdzania sesji:", err);
          }
        } finally {
          setIsLoading(false);
        }
      };
      
      checkActiveSession();
    } else {
      // Jeśli nie ma stationId, od razu ustaw isLoading na false (nie pokazuj ekranu ładowania)
      setIsLoading(false);
    }
  }, [stationId]);

  // Socket.io do nasłuchiwania na aktualizacje energii z OCPP
  useEffect(() => {
    if (viewState === "charging" && stationId) {
      const newSocket = io(API_URL, { transports: ["websocket", "polling"] });
      
      newSocket.on("connect", () => {
        console.log("[Socket.IO] Połączono z serwerem");
      });
      
      newSocket.on("energy_update", (data: any) => {
        console.log("[Socket.IO] Otrzymano energy_update:", data);
        if (data.stationId === stationId && data.energy !== null) {
          const energyKwh = data.energy / 1000; // Konwersja z Wh na kWh
          setEnergyKwh(energyKwh);
          console.log("[Socket.IO] Zaktualizowano energię:", energyKwh, "kWh");
        }
      });
      
      newSocket.on("disconnect", () => {
        console.log("[Socket.IO] Rozłączono z serwerem");
      });
      
      setSocket(newSocket);
      return () => {
        newSocket.disconnect();
        setSocket(null);
      };
    }
  }, [viewState, stationId]);

  // Polling energii z bazy danych jako fallback (co 2 sekundy)
  useEffect(() => {
    if (viewState === "charging" && stationId) {
      const fetchEnergy = async () => {
        try {
          const response = await axios.get(`${API_URL}/energy/${stationId}`);
          if (response.data.success && response.data.energyKwh !== undefined) {
            setEnergyKwh(response.data.energyKwh);
          }
        } catch (err) {
          console.error("Błąd pobierania energii:", err);
        }
      };

      // Pobierz od razu
      fetchEnergy();
      
      // Następnie co 2 sekundy
      const interval = setInterval(fetchEnergy, 2000);
      
      return () => clearInterval(interval);
    }
  }, [viewState, stationId]);

  useEffect(() => {
    if (viewState === "charging" && sessionStartTime) {
      const interval = setInterval(() => {
        const now = new Date();
        setSessionDuration(Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewState, sessionStartTime]);

  const initializePayment = async () => {
    if (!stationId || debouncedAmount <= 0) return;
    
    setIsInitializingPayment(true);
    setShowPaymentForm(false);
    try {
      setClientSecret(""); 
      const requestBody: { amount: number; stationId: string; connectorId?: string } = {
        amount: debouncedAmount * 100,
        stationId: stationId,
      };
      
      // Dodaj connectorId jeśli jest wybrane
      if (connectorId) {
        requestBody.connectorId = connectorId;
      }
      
      const res = await axios.post(`${API_URL}/create-payment-intent`, requestBody);
      setClientSecret(res.data.clientSecret);
      setShowPaymentForm(true);
    } catch (err) {
      console.error("Błąd płatności:", err);
      alert("Nie udało się zainicjować płatności. Sprawdź konsolę.");
    } finally {
      setIsInitializingPayment(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSelectConnector = (id: string) => {
    setConnectorId(id);
    setViewState("payment");
    setShowPaymentForm(false);
    setClientSecret("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = Number(e.target.value);
    if (val > 500) val = 500;
    if (val < 0) val = 0;
    setAmount(val);
  };

  const handlePaymentSuccess = async () => {
    if (!stationId) {
      alert("Brak ID stacji. Sprawdź URL.");
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/start/${stationId}`);
      
      if (response.data.success) {
        // Zapisz transactionId w localStorage
        const transactionId = response.data.transactionId || response.data.data?.transactionId;
        if (transactionId) {
          localStorage.setItem('active_session_id', transactionId);
          console.log(`[Session] Zapisano transactionId w localStorage: ${transactionId}`);
        }
        
        setViewState("charging");
        setSessionStartTime(new Date());
        setEnergyKwh(0);
      } else {
        alert(`Błąd: ${response.data.message || "Nie udało się rozpocząć ładowania"}`);
      }
    } catch (err: any) {
      console.error("Błąd startu stacji:", err);
      const errorMessage = err.response?.data?.message || err.message || "Nie udało się rozpocząć ładowania";
      alert(`Błąd startu stacji: ${errorMessage}`);
    }
  };

  const handleStopCharging = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      const params = customerEmail ? `?email=${encodeURIComponent(customerEmail)}` : '';
      const response = await axios.get(`${API_URL}/stop/${stationId}${params}`);
      
      if (response.data.success) {
        // Usuń sessionId z localStorage po zakończeniu ładowania
        localStorage.removeItem('active_session_id');
        console.log(`[Session] Usunięto sessionId z localStorage po zakończeniu ładowania`);
        
        // Użyj danych z backendu (zawierają rzeczywiste wartości z bazy danych)
        const finalCost = response.data.finalCost || (energyKwh * PRICE_PER_KWH);
        const refundAmount = response.data.refundAmount || Math.max(0, amount - finalCost);
        
        setLastSessionCost(finalCost);
        setRefundAmount(refundAmount);
        
        if (response.data.invoiceSent && response.data.email) {
          setInvoiceEmail(response.data.email);
        }
        
        if (socket) socket.disconnect();
        setViewState("summary");
      } else {
        alert(`Błąd: ${response.data.message || "Nie udało się zakończyć ładowania"}`);
      }
    } catch (err: any) {
      console.error("Błąd zatrzymywania:", err);
      const errorMessage = err.response?.data?.message || err.message || "Nie udało się zakończyć ładowania";
      alert(`Błąd zatrzymywania: ${errorMessage}`);
    } finally {
      setIsStopping(false);
    }
  };

  // --- RENDEROWANIE WIDOKÓW ---

  // 0. WIDOK WYBORU STACJI (gdy brak stationId)
  if (!stationId) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-900">
        <div className="max-w-2xl mx-auto">
          {/* Nagłówek */}
          <div className="text-center mb-6 mt-8">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Znajdź stację ładowania</h1>
            <p className="text-slate-500 font-medium">Wybierz stację z listy poniżej</p>
          </div>

          {/* Przycisk geolokacji */}
          <div className="mb-6 flex justify-center">
            <button
              onClick={handleRequestLocation}
              disabled={isRequestingLocation}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isRequestingLocation ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Pobieranie lokalizacji...
                </>
              ) : (
                <>
                  <Navigation size={20} />
                  📍 Udostępnij lokalizację
                </>
              )}
            </button>
          </div>

          {locationError && (
            <div className="mb-4 p-3 bg-rose-50 text-rose-600 text-sm rounded-lg flex items-center gap-2 border border-rose-100">
              <AlertCircle size={16} />
              {locationError}
            </div>
          )}

          {/* Sekcja Filtrów */}
          <div className="mb-4">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="w-full px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Filter size={18} />
                <span>Filtruj</span>
              </div>
              {showFilters ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

            {showFilters && (
              <div className="mt-3 p-4 bg-white rounded-xl border border-slate-200 space-y-4">
                {/* Filtrowanie po cenie */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Cena</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPriceSort(priceSort === "asc" ? null : "asc")}
                      className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                        priceSort === "asc"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Rosnąco
                    </button>
                    <button
                      onClick={() => setPriceSort(priceSort === "desc" ? null : "desc")}
                      className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                        priceSort === "desc"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Malejąco
                    </button>
                  </div>
                </div>

                {/* Filtrowanie po statusie */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Status</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStatusFilter("all")}
                      className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                        statusFilter === "all"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Wszystkie
                    </button>
                    <button
                      onClick={() => setStatusFilter("available")}
                      className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                        statusFilter === "available"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Tylko Wolne
                    </button>
                  </div>
                </div>

                {/* Sortowanie po lokalizacji */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Lokalizacja</label>
                  <button
                    onClick={() => {
                      if (locationSort) {
                        setLocationSort(false);
                      } else {
                        if (!userLocation) {
                          handleRequestLocation();
                          setLocationSort(true);
                        } else {
                          setLocationSort(true);
                        }
                      }
                    }}
                    className={`w-full py-2 px-4 rounded-lg font-medium transition-all ${
                      locationSort
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {locationSort ? "✓ Najbliżej mnie" : "Najbliżej mnie"}
                  </button>
                  {locationSort && !userLocation && (
                    <p className="text-xs text-slate-500 mt-2">Zgoda na geolokalizację jest wymagana</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Lista stacji */}
          {isLoadingStations ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                  <Zap size={32} className="text-emerald-600 animate-pulse" fill="currentColor" />
                </div>
                <p className="text-slate-500 font-medium">Ładowanie stacji...</p>
              </div>
            </div>
          ) : stations.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 font-medium">Brak dostępnych stacji</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stations.map((station) => {
                // Oblicz dostępność złączy
                const connectors = station.connectors || [];
                const total = connectors.length;
                // Użyj availableCount z API jeśli dostępne, w przeciwnym razie oblicz lokalnie
                const available = station.availableCount !== undefined 
                  ? station.availableCount 
                  : connectors.filter(c => c.status === 'AVAILABLE').length;
                
                // Określ kolor pastylki dostępności zgodnie z nową logiką
                let availabilityBadgeColor = '';
                let availabilityText = '';
                if (total > 0) {
                  if (available === total) {
                    // ZIELONY: Wszystkie złącza są wolne
                    availabilityBadgeColor = 'bg-emerald-50 text-emerald-700';
                    availabilityText = `${available}/${total} Dostępne`;
                  } else if (available > 0 && available < total) {
                    // ŻÓŁTY/POMARAŃCZOWY: Część złączy zajęta
                    availabilityBadgeColor = 'bg-amber-50 text-amber-700';
                    availabilityText = `${available}/${total} Dostępne`;
                  } else if (available === 0) {
                    // CZERWONY: Wszystkie złącza zajęte lub awaria
                    availabilityBadgeColor = 'bg-red-50 text-red-700';
                    availabilityText = `${available}/${total} Dostępne`;
                  }
                } else {
                  // Brak danych o złączach
                  availabilityBadgeColor = 'bg-slate-100 text-slate-600';
                  availabilityText = 'Brak danych';
                }
                
                const isAvailable = available > 0;
                
                // Pobierz unikalne typy złączy
                const connectorTypes = Array.from(new Set(connectors.map(c => c.type))).filter(Boolean);
                
                return (
                  <div
                    key={station.id}
                    className="bg-white rounded-2xl border-2 border-slate-100 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 transition-all p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-bold text-slate-900">{station.name}</h3>
                        </div>
                        
                        {(station.address || station.city) && (
                          <div className="flex items-center gap-2 text-slate-500 font-medium mb-2">
                            <MapPin size={16} />
                            <span>
                              {station.address && <span>{station.address}</span>}
                              {station.address && station.city && <span>, </span>}
                              {station.city && <span>{station.city}</span>}
                            </span>
                          </div>
                        )}

                        {/* Typy złączy */}
                        {connectorTypes.length > 0 && (
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {connectorTypes.map((type, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-1 text-xs font-bold bg-slate-100 text-slate-700 rounded-md"
                              >
                                {type}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-4 mt-3">
                          <span className="text-sm font-bold text-emerald-600">
                            od {station.pricePerKwh.toFixed(2)} zł/kWh
                          </span>
                          {station.distance !== undefined && (
                            <span className="text-sm text-slate-500 font-medium">
                              {station.distance.toFixed(1)} km stąd
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Pastylka statusu dostępności */}
                        {connectors.length > 0 && (
                          <span className={`px-3 py-2 rounded-lg text-xs font-bold ${availabilityBadgeColor}`}>
                            {availabilityText}
                          </span>
                        )}
                        
                        {/* Przycisk Wybierz */}
                        <button
                          onClick={() => handleSelectStation(station.id)}
                          disabled={!isAvailable}
                          className={`px-6 py-3 rounded-xl font-bold transition-all ${
                            isAvailable
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-[0.98]'
                              : 'bg-slate-200 text-slate-500 cursor-not-allowed opacity-50'
                          }`}
                        >
                          Wybierz
                        </button>
                        
                        {/* Przycisk Nawiguj */}
                        {station.latitude && station.longitude && (
                          <button
                            onClick={() => handleNavigateToStation(station)}
                            className="w-12 h-12 flex items-center justify-center bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-all active:scale-[0.98]"
                            title="Nawiguj do stacji"
                          >
                            <Navigation size={20} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Ekran ładowania podczas sprawdzania sesji (tylko gdy jest stationId)
  if (isLoading && stationId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4 font-sans">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
            <Zap size={40} className="text-emerald-600 animate-pulse" fill="currentColor" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-900">Łączenie ze stacją...</h2>
            <p className="text-sm text-slate-500 font-medium">Sprawdzanie aktywnej sesji</p>
          </div>
        </div>
      </div>
    );
  }

  // 1. WYBÓR ZŁĄCZA (gdy jest stationId ale viewState === "idle")
  if (viewState === "idle" && stationId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          <div className="bg-white p-8 pb-4 border-b border-slate-50">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
              <Zap size={32} fill="currentColor" />
            </div>
            <div className="flex flex-col items-center text-center space-y-2">
              {/* Linia 1: Nazwa Stacji */}
              <h1 className="text-2xl font-extrabold text-slate-900">{stationName || `Stacja ${stationId || "Demo"}`}</h1>
              
              {/* Linia 2: Adres stacji */}
              {(stationAddress || stationCity) && (
                <p className="text-slate-500 font-medium text-sm">
                  {stationAddress && <span>{stationAddress}</span>}
                  {stationAddress && stationCity && <span>, </span>}
                  {stationCity && <span>{stationCity}</span>}
                </p>
              )}
              
              {/* Linia 3: Przycisk Wybierz inny punkt */}
              <button 
                onClick={handleBackToStationSelection}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors mt-1"
              >
                <span>📍</span>
                <span>Wybierz inny punkt ładowania</span>
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {connectors.map((c) => {
              const Icon = c.icon;
              // Złącze jest nieaktywne jeśli status to 'FAULTED', 'UNAVAILABLE', 'CHARGING' lub 'OCCUPIED'
              const isUnavailable = c.status === 'FAULTED' || c.status === 'UNAVAILABLE' || c.status === 'CHARGING' || c.status === 'OCCUPIED';
              // Wyszarzanie tylko dla FAULTED (awaria)
              const isFaulted = c.status === 'FAULTED';
              const statusText = getStatusText(c.status);
              
              return (
                <button
                  key={c.id}
                  disabled={isUnavailable}
                  onClick={() => !isUnavailable && handleSelectConnector(c.id)}
                  className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all duration-200 group text-left
                    ${isFaulted 
                      ? 'border-slate-50 bg-slate-50 opacity-50 cursor-not-allowed grayscale' 
                      : isUnavailable
                      ? 'border-slate-100 bg-slate-50 opacity-75 cursor-not-allowed'
                      : 'border-slate-100 bg-white hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 active:scale-[0.98]'
                    }
                  `}
                >
                  <div className="flex items-center gap-5">
                    <div className={`p-3.5 rounded-xl ${isUnavailable ? 'bg-slate-200 text-slate-400' : 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'}`}>
                      <Icon size={28} strokeWidth={2} />
                    </div>
                    <div>
                      <p className={`font-bold text-lg ${isUnavailable ? 'text-slate-500' : 'text-slate-800 group-hover:text-emerald-900'}`}>{c.name}</p>
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <span>{c.type}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>{c.power}</span>
                      </div>
                      <p className="text-sm font-bold text-emerald-600 mt-1">{c.pricePerKwh.toFixed(2)} zł/kWh</p>
                      {isUnavailable && (
                        <p className="text-xs text-slate-400 font-medium mt-1">{statusText}</p>
                      )}
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    isUnavailable 
                      ? 'bg-slate-200 text-slate-500' 
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {statusText}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 2. DOKONAJ PRZEDPŁATY
  if (viewState === "payment") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          
          <div className="p-6 border-b border-slate-50 flex items-center">
            <button onClick={() => setViewState('idle')} className="p-2 -ml-2 hover:bg-slate-50 rounded-full text-slate-400 transition-colors">
              <ArrowLeft size={24} />
            </button>
            <span className="font-bold text-lg text-slate-800 ml-2">Dokonaj przedpłaty</span>
          </div>

          <div className="p-8 space-y-8">
            {/* Nazwa stacji na górze */}
            {stationName && (
              <div className="text-center pb-2">
                <p className="text-sm text-slate-500 font-medium mb-1">Stacja</p>
                <p className="text-xl font-bold text-slate-900">{stationName}</p>
              </div>
            )}
            
            <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <div className="p-3 bg-white rounded-xl shadow-sm text-emerald-600">
                {selectedConnectorData?.icon && <selectedConnectorData.icon size={24} />}
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-0.5">WYBRANO</p>
                <p className="font-bold text-slate-900">{selectedConnectorData?.name}</p>
                <p className="text-xs text-slate-500 font-medium">{selectedConnectorData?.power} • {selectedConnectorData?.type}</p>
              </div>
            </div>

            <div className="text-center py-4">
              <div className="relative inline-flex items-center justify-center">
                <input
                  type="number"
                  value={amount}
                  onChange={handleAmountChange}
                  className="text-7xl font-black text-slate-900 text-center w-48 bg-transparent border-b-2 border-slate-200 focus:border-emerald-500 focus:outline-none p-0 pb-2 transition-colors" 
                />
                <span className="text-2xl font-bold text-slate-400 ml-2 mt-4">PLN</span>
              </div>
              <p className="text-slate-400 font-medium text-sm mt-4">Wpisz kwotę lub użyj suwaka</p>
            </div>

            <div className="px-2">
              <input
                type="range"
                min="20"
                max="500"
                step="5"
                value={amount}
                onChange={handleAmountChange}
                className="w-full h-4 bg-slate-100 rounded-full appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-500 transition-all"
              />
              <div className="flex justify-between text-xs font-bold text-slate-400 mt-3 px-1">
                <span>20 PLN</span>
                <span>500 PLN</span>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="bg-blue-50/50 p-4 rounded-xl flex gap-3 items-start border border-blue-100">
                <Info className="text-blue-500 shrink-0 mt-0.5" size={18} />
                <p className="text-xs text-blue-700 font-medium leading-relaxed">
                  Niewykorzystane środki zostaną automatycznie zwrócone na Twoją kartę natychmiast po zakończeniu ładowania.
                </p>
              </div>

              {/* PRZYCISK DO PŁATNOŚCI */}
              {!showPaymentForm && !isInitializingPayment && (
                <button
                  onClick={initializePayment}
                  disabled={amount <= 0 || amount > 500}
                  className="w-full py-5 px-6 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  <CreditCard size={24} />
                  Przejdź do płatności {amount} zł
                </button>
              )}

              {/* KONTENER PŁATNOŚCI */}
              {showPaymentForm && (
                <div className="min-h-[100px] w-full">
                  {isInitializingPayment ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-emerald-500 rounded-full"></div>
                      <p className="text-sm text-slate-400 font-medium">Łączenie z bankiem...</p>
                    </div>
                  ) : clientSecret ? (
                    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#059669' } } }}>
                      <CheckoutForm 
                        amount={debouncedAmount} 
                        onSuccess={handlePaymentSuccess} 
                        onCancel={() => {
                          setShowPaymentForm(false);
                          setClientSecret("");
                        }}
                        stationName={stationName || undefined}
                      />
                    </Elements>
                  ) : (
                    <div className="p-4 bg-rose-50 text-rose-600 text-sm rounded-xl border border-rose-100 text-center">
                      Nie udało się połączyć z serwerem płatności. Sprawdź czy backend działa.
                    </div>
                  )}
                </div>
              )}

              {/* Przycisk Pomoc */}
              <button
                onClick={handleHelpClick}
                className="w-full py-4 px-6 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
              >
                <HelpCircle size={20} />
                Pomoc
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. ŁADOWANIE W CZASIE RZECZYWISTYM
  if (viewState === "charging") {
    const currentCost = energyKwh * PRICE_PER_KWH;
    const percentageUsed = amount > 0 ? (currentCost / amount) * 100 : 0;
    const remainingAmount = Math.max(0, amount - currentCost);

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          
          {/* Header */}
          <div className="p-6 border-b border-slate-50 bg-gradient-to-r from-emerald-50 to-emerald-100/50">
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-lg shadow-emerald-500/50"></div>
                  <span className="font-bold text-lg text-slate-900">Ładowanie aktywne</span>
                </div>
                {selectedConnectorData && (
                  <div className="px-3 py-1.5 bg-white rounded-full border border-emerald-200">
                    <span className="text-xs font-bold text-emerald-700">{selectedConnectorData.power}</span>
                  </div>
                )}
              </div>
              {(stationAddress || stationCity) && (
                <div className="flex flex-col space-y-1">
                  <p className="text-sm text-slate-600 font-medium">
                    {stationAddress && <span>{stationAddress}</span>}
                    {stationAddress && stationCity && <span>, </span>}
                    {stationCity && <span>{stationCity}</span>}
                  </p>
                  <button 
                    onClick={handleBackToStationSelection}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors self-start"
                  >
                    <span>📍</span>
                    <span>Wybierz inny punkt ładowania</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="p-8 space-y-6">
            {/* Informacja o wybranej ładowarce */}
            {selectedConnectorData && (
              <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600">
                  {selectedConnectorData.icon && <selectedConnectorData.icon size={24} />}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-slate-900">{selectedConnectorData.name}</p>
                  <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                    <span>{selectedConnectorData.type}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span>{selectedConnectorData.power}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Główna metryka - Pobrana energia */}
            <div className="text-center py-6">
              <h1 className="text-6xl font-black tracking-tight mb-2 text-slate-900">{energyKwh.toFixed(2)}</h1>
              <p className="text-slate-500 font-medium text-lg">Pobrana energia (kWh)</p>
            </div>

            {/* Statystyki */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <Wallet className="text-emerald-600 mb-3 mx-auto" size={24} />
                <p className="text-3xl font-bold mb-1 text-slate-900">{currentCost.toFixed(2)} <span className="text-sm text-slate-500">zł</span></p>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Koszt</p>
              </div>
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <Clock className="text-blue-600 mb-3 mx-auto" size={24} />
                <p className="text-3xl font-bold mb-1 font-mono text-slate-900">{formatTime(sessionDuration)}</p>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Czas trwania</p>
              </div>
            </div>

            {/* Pasek wykorzystania środków */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-3">
              <div className="flex justify-between text-sm font-medium text-slate-700">
                <span>Wykorzystano środków</span>
                <span className="font-bold">{currentCost.toFixed(2)} / {amount.toFixed(2)} zł</span>
              </div>
              <div className="h-4 bg-slate-200 rounded-full overflow-hidden relative">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(percentageUsed, 100)}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Pozostało: {remainingAmount.toFixed(2)} zł</span>
                <span>{percentageUsed.toFixed(1)}% wykorzystano</span>
              </div>
            </div>

            {/* Email do faktury */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <label className="block text-xs text-slate-600 font-medium uppercase tracking-wide mb-2">
                Email do faktury (opcjonalnie)
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="twoj@email.pl"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
              />
            </div>

            {/* Przycisk zakończenia */}
            <button
              onClick={handleStopCharging}
              disabled={isStopping}
              className="w-full py-5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-2xl font-bold text-lg transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isStopping ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
                  Zatrzymywanie...
                </span>
              ) : (
                <>
                  <div className="w-3 h-3 bg-red-600 rounded-sm"></div>
                  Zakończ ładowanie
                </>
              )}
            </button>

            {/* Przycisk Pomoc */}
            <button
              onClick={handleHelpClick}
              className="w-full py-4 px-6 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
            >
              <HelpCircle size={20} />
              Pomoc
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === "summary") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 p-8 text-center space-y-8 border border-slate-100 animate-in zoom-in-95 duration-300">
          <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="text-emerald-600" size={48} strokeWidth={3} />
          </div>
          
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Gotowe!</h2>
            <p className="text-slate-500 font-medium">Ładowanie zakończone pomyślnie</p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-100">
            <div className="flex justify-between border-b border-slate-200 pb-4">
              <span className="text-slate-500 font-medium">Pobrana energia</span>
              <span className="font-bold text-slate-900 text-lg">{energyKwh.toFixed(2)} kWh</span>
            </div>
            <div className="flex justify-between border-b border-slate-200 pb-4">
              <span className="text-slate-500 font-medium">Czas trwania</span>
              <span className="font-bold text-slate-900 text-lg">{formatTime(sessionDuration)}</span>
            </div>
            <div className="flex justify-between pt-2">
              <span className="text-slate-500 font-medium">Koszt całkowity</span>
              <span className="font-bold text-slate-900 text-xl">{lastSessionCost.toFixed(2)} zł</span>
            </div>
          </div>

          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100/50 shadow-sm">
            <p className="text-emerald-900 font-bold text-xl mb-1">Zwrot na kartę: {refundAmount.toFixed(2)} zł</p>
            <p className="text-xs text-emerald-700 font-medium opacity-80">Środki wrócą na Twoje konto w ciągu kilku chwil.</p>
          </div>

          {invoiceEmail && (
            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100/50 shadow-sm">
              <div className="flex items-start gap-3">
                <Info className="text-blue-600 shrink-0 mt-0.5" size={20} />
                <div className="text-left">
                  <p className="text-blue-900 font-bold text-sm mb-1">Faktura wysłana</p>
                  <p className="text-xs text-blue-700 font-medium opacity-80">
                    Faktura została wysłana na adres: <span className="font-bold">{invoiceEmail}</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          <button 
            onClick={() => {
              setViewState("idle");
              setAmount(50);
              setConnectorId(null);
              setInvoiceEmail(null);
              setCustomerEmail("");
            }}
            className="w-full py-4 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl font-bold transition-all"
          >
            Wróć do ekranu głównego
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Ładowanie aplikacji...</div>}>
      <HomeContent />
    </Suspense>
  );
}