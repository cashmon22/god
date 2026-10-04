import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bitcoin,
  Building2,
  Wallet,
  X,
} from "lucide-react";
import DeviceNotRecognizedModal from "./DeviceNotRecognizedModal";

interface WithdrawModalProps {
  availableBalance: number;
  deviceVerified: boolean;
  kycVerified: boolean;
  onClose: () => void;
  onContactVendor: () => void;
  onVerifyKyc: () => void;
}

type Step = "method" | "crypto" | "bank" | "device-blocked" | "kyc-blocked";

const cryptoNetworks = [
  { id: "btc", label: "Bitcoin (BTC)" },
  { id: "eth", label: "Ethereum (ETH)" },
  { id: "usdt-trc20", label: "USDT — TRC20" },
  { id: "usdt-erc20", label: "USDT — ERC20" },
  { id: "usdc", label: "USD Coin (USDC)" },
  { id: "bnb", label: "BNB Smart Chain" },
];

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-navy placeholder:text-slate-400 transition focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20";
const labelClass =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500";

export default function WithdrawModal({
  availableBalance,
  deviceVerified,
  kycVerified,
  onClose,
  onContactVendor,
  onVerifyKyc,
}: WithdrawModalProps) {
  // The withdrawal form is always shown first. Device and KYC checks run only
  // when the contributor submits the withdrawal (see handleContinue).
  const [step, setStep] = useState<Step>("method");

  // Crypto form state
  const [cryptoNetwork, setCryptoNetwork] = useState("");
  const [cryptoAddress, setCryptoAddress] = useState("");
  const [cryptoAmount, setCryptoAmount] = useState("");

  // Bank form state
  const [accountHolder, setAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [swiftCode, setSwiftCode] = useState("");

  const handleContinue = () => {
    // Security checks run in order on submit: device verification, then KYC.
    if (!deviceVerified) {
      setStep("device-blocked");
      return;
    }
    if (!kycVerified) {
      setStep("kyc-blocked");
    }
    // If device is verified, the actual submission would happen here.
  };

  const handleClose = () => {
    setStep("method");
    onClose();
  };

  return (
    <>
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdraw-modal-title"
      >
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-orange/10 blur-3xl" />

        {/* Header */}
        <div className="relative flex items-center justify-between border-b border-slate-100 bg-[#fbfcfd] p-5 sm:p-6">
          <div className="flex items-center gap-3 pr-8">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy text-orange shadow-[0_8px_20px_rgba(19,30,41,0.14)]">
              <Wallet size={22} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
                Withdrawal
              </p>
              <h2
                id="withdraw-modal-title"
                className="mt-1 text-xl font-extrabold tracking-[-0.03em] text-navy sm:text-2xl"
              >
                {step === "method" && "Withdraw Funds"}
                {step === "crypto" && "Withdraw via Crypto"}
                {step === "bank" && "Connect Bank Account"}
                {step === "kyc-blocked" && "KYC Verification Required"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close withdrawal dialog"
            className="absolute right-4 top-4 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="relative max-h-[60vh] overflow-y-auto p-5 sm:p-7">
          {/* Balance display — shown on method + form steps */}
          {step !== "device-blocked" && step !== "kyc-blocked" && (
            <div className="mb-5 flex items-center justify-between rounded-lg border border-orange/25 bg-orange/[0.06] px-4 py-3">
              <span className="text-xs font-bold text-slate-500">
                Available balance
              </span>
              <span className="text-lg font-extrabold tracking-[-0.03em] text-orange">
                ${availableBalance.toFixed(2)}
              </span>
            </div>
          )}

          {step === "kyc-blocked" && (
            <div>
              <p className="text-sm font-extrabold text-navy">KYC Verification Required</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Your account is active, but your identity has not yet been approved. Complete KYC verification before adding withdrawal details or withdrawing your earnings.</p>
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onVerifyKyc();
                }}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy transition hover:bg-orange-light sm:w-auto"
              >
                Verify KYC <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Step 1: Method selection */}
          {step === "method" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setStep("crypto")}
                className="flex w-full items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange hover:shadow-md"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-orange/10 text-orange">
                  <Bitcoin size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-navy">
                    Withdraw via Crypto
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Receive funds directly to your crypto wallet address.
                  </p>
                </div>
                <ArrowRight size={18} className="shrink-0 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => setStep("bank")}
                className="flex w-full items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange hover:shadow-md"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Building2 size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-navy">
                    Connect Bank Account
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Transfer funds directly to your bank account.
                  </p>
                </div>
                <ArrowRight size={18} className="shrink-0 text-slate-400" />
              </button>
            </div>
          )}

          {/* Step 2: Crypto form */}
          {step === "crypto" && (
            <div className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="crypto-network">
                  Network / Coin
                </label>
                <select
                  id="crypto-network"
                  value={cryptoNetwork}
                  onChange={(e) => setCryptoNetwork(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a network</option>
                  {cryptoNetworks.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="crypto-address">
                  Wallet Address
                </label>
                <input
                  id="crypto-address"
                  type="text"
                  value={cryptoAddress}
                  onChange={(e) => setCryptoAddress(e.target.value)}
                  placeholder="Enter your wallet address"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="crypto-amount">
                  Amount (USD)
                </label>
                <input
                  id="crypto-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cryptoAmount}
                  onChange={(e) => setCryptoAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                />
                <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                  Maximum withdrawable: ${availableBalance.toFixed(2)}
                </p>
              </div>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setStep("method")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 transition hover:border-navy hover:text-navy"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy shadow-[0_4px_14px_rgba(255,153,0,0.18)] transition hover:-translate-y-0.5 hover:bg-orange-light"
                >
                  Withdraw <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Bank form */}
          {step === "bank" && (
            <div className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="account-holder">
                  Account Holder Name
                </label>
                <input
                  id="account-holder"
                  type="text"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  placeholder="Full name on account"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="bank-name">
                  Bank Name
                </label>
                <input
                  id="bank-name"
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Enter your bank name"
                  className={inputClass}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="account-number">
                    Account Number
                  </label>
                  <input
                    id="account-number"
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="routing-number">
                    Routing Number / IBAN
                  </label>
                  <input
                    id="routing-number"
                    type="text"
                    value={routingNumber}
                    onChange={(e) => setRoutingNumber(e.target.value)}
                    placeholder="Routing or IBAN"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="swift-code">
                  SWIFT / BIC Code
                </label>
                <input
                  id="swift-code"
                  type="text"
                  value={swiftCode}
                  onChange={(e) => setSwiftCode(e.target.value)}
                  placeholder="SWIFT or BIC code"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setStep("method")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 transition hover:border-navy hover:text-navy"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy shadow-[0_4px_14px_rgba(255,153,0,0.18)] transition hover:-translate-y-0.5 hover:bg-orange-light"
                >
                  Withdraw <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
    {step === "device-blocked" && <DeviceNotRecognizedModal onClose={handleClose} onVerifyDevice={() => { handleClose(); onContactVendor(); }} />}
    </>
  );
}
