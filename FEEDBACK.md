# DreamDEX / Somnia integration feedback

These are concrete issues encountered while building and testing Oracle Arena; they are not hypothetical feature requests.

- The Somnia-operated RPC returned HTTP 403 in this environment, while the Ankr Somnia Testnet endpoint accepted the same individual reads. Clear RPC availability/fallback guidance would reduce integration time.
- DreamDEX SDK write helpers can resolve with a transaction receipt whose `status` is `reverted`. A prominent warning and checked helper in the quick start would prevent callers from treating a resolved Promise as success.
- The SDK's default signer path used a Somnia WebSocket send flow that was not usable with the available endpoint. Documenting the supported HTTP-only writer injection path would help scheduled agents.
- Binary settlement v2/v3 moved redeem from the pool to the module/settlement singleton. A short migration table covering `resolved`, `voided`, `finalized`, payout-vector denominator, operator approval, and `claimOwed` would make safe redeem implementations much easier to audit.
- Opening/reference price scale is asset-dependent. Returning a normalized decimal value alongside the raw oracle answer would avoid client-side scale inference.
