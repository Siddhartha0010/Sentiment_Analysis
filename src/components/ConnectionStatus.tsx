import { Wifi, WifiOff, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ConnectionStatusProps {
  isConnected: boolean;
  isDemoMode?: boolean;
}

export const ConnectionStatus = ({ isConnected, isDemoMode }: ConnectionStatusProps) => {
  if (isDemoMode) {
    return (
      <div className="flex justify-center">
        <Badge 
          variant="secondary"
          className="flex items-center gap-2 px-4 py-2"
        >
          <FlaskConical className="h-4 w-4" />
          <span>Demo Mode - Simulated Data</span>
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <Badge 
        variant={isConnected ? "default" : "destructive"}
        className="flex items-center gap-2 px-4 py-2"
      >
        {isConnected ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>Connected to Server</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>Connecting...</span>
          </>
        )}
      </Badge>
    </div>
  );
};
