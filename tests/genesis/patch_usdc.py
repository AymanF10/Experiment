import base64
import base58
import json
import sys
with open("tests/genesis/usdc.json", "r") as f:
	usdc = json.load(f)
data = bytearray(base64.b64decode(usdc["account"]["data"][0]))
ADDRESS = "BBWpMG3mXtGVMNVzGJSAVjkKqVixMXepWELv3fBL1RtU"
data[4:4+32] = base58.b58decode(ADDRESS)
usdc["account"]["data"][0] = base64.b64encode(data).decode("utf8")
with open("tests/genesis/usdc.json", "w") as f:
	json.dump(usdc, f, indent=2)
print("wrote tests/genesis/usdc_clone.json")
