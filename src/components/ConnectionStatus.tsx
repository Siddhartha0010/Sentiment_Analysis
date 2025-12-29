import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ConnectionStatusProps {
  isConnected: boolean;
}

export const ConnectionStatus = ({ isConnected }: ConnectionStatusProps) => {
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
            <span>Disconnected - Reconnecting...</span>
          </>
        )}
      </Badge>
    </div>
  );
};
