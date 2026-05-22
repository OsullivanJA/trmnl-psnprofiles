# trmnl-psnprofiles
Fetch information from PSN API for username

The project uses the psn-api library, which requires an NPSSO token. Here's how to get/refresh it:

Log in to PlayStation.com in your browser
Navigate to this URL in the same browser session:

https://ca.account.sony.com/api/v1/ssocookie
You'll get a JSON response like {"npsso":"<your_token>"} — copy that value
Update your environment variable:

PSN_NPSSO=<your_new_token>
The NPSSO token expires after ~2 months of inactivity or when you log out of PSN. 
